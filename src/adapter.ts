import {join, dirname, sep} from 'path';
import * as fs from 'fs';
import * as path from 'path';
import {spawn} from 'child_process';
import {StreamCatcher} from './streamCatcher';
import * as RX from './regExp';
import variableParser, { ParsedVariable, ParsedVariableScope } from './variableParser';
import { DebugSession, LaunchOptions } from './session';
import { LocalSession } from './localSession';
import { RemoteSession } from './remoteSession';
import { PerlDebugSession } from './perlDebug';

import {
	Event as VscodeEvent
} from 'vscode-debugadapter';
import { EventEmitter } from 'events';

interface ResponseError {
	filename: string,
	ln: number,
	message: string,
	near: string,
	type: string,
	name: string,
}

interface Variable {
	name: string,
	type: string,
	value: any,
	variablesReference: number,
}

interface StackFrame {
	v: string,
	name: string,
	filename: string,
	caller: string,
	ln: number,
}

export interface RequestResponse {
	data?: string[],
	orgData: string[],
	ln: number,
	errors: ResponseError[],
	name: string,
	filename: string,
	exception: boolean,
	finished: boolean,
	command?:string,
	db?:string,
}

function findFilenameLine(str: string): string[] {
	// main::(test.pl:8):
	const fileMatch = str.match(RX.fileMatch);
	// at test.pl line 10
	const fileMatchException = str.match(RX.fileMatchException);

	return fileMatch || fileMatchException || [];
}

function variableType(key: string, val: string): string {
	if (/^['|"]/.test(val)) {
		return 'string';
	}
	if (/^([0-9\,\.]+)$/) {
		return 'integer';
	}

	return 'Unknown';
}

function variableValue(val: string): any {
	if (/^['|"]/.test(val)) {
		return val.replace(/^'/, '').replace(/'$/, '');
	}
	if (/^([0-9\,\.]+)$/) {
		return +val;
	}

	return val;
}

function absoluteFilename(root: string, filename: string): string {
	// if it's already absolute then return
	if (fs.existsSync(filename)) {
		return filename;
	}

	// otherwise assume it's a relative filename
	const fullPath = join(root, filename);
	if (fs.existsSync(fullPath)) {
		return fullPath;
	}

	// xxx: We might want to resolve module names later on
	// using this.resolveFilename, for now we just return the joined path
	return join(root, filename);
}

export class perlDebuggerConnection extends EventEmitter {
	public debug: boolean = false;
	public perlDebugger: DebugSession;
	public debuggee?: DebugSession;

	public streamCatcher: StreamCatcher;
	public perlVersion: string;
	public padwalkerVersion: string;
	public commandRunning: string = '';
	public isRemote: boolean = false;
	public debuggerPid?: number;

	private filename?: string;
	private rootPath?: string;
	private currentfile?: string;

	/**
	 * Pass in the initial script and optional additional arguments for
	 * running the script.
	 */
	constructor() {
		super();
		this.streamCatcher = new StreamCatcher();
	}

	async initializeRequest() {
	}

	logOutput(data: string) {
		this.emit('perl-debug.output', data);
	}

	logData(prefix: string, data: string[]) {
		data.forEach((val, i) => {
			this.logOutput(`${prefix}${val}`);
		});
	}

	logDebug(...args: any[]) {
		this.emit('perl-debug.debug', ...args);
		if (this.debug) {
			console.log(...args);
		}
	}

	logRequestResponse(res: RequestResponse) {
		this.logDebug(res);
	}

	parseResponse(data: string[]): RequestResponse {
		const res: RequestResponse = {
			data: [],
			orgData: data,
			ln: 0,
			errors: [],
			name: '',
			filename: '',
			exception: false,
			finished: false,
			command: '',
			db: '',
		};

		res.orgData.forEach((line, i) => {
			if (i === 0) {
				// Command line
				res.command = line;
			} else if (i === res.orgData.length - 1) {
				// DB
				const dbX = RX.lastCommandLine.match(line);
				if (dbX) {
					res.db = dbX[1];
				}
			} else {
				// Contents
				line = line.replace(RX.colors, '');
				if (!RX.isGarbageLine(line)) {
					res.data.push(line);
				}

				// Grap the last filename and line number
				const [, filename, ln] = findFilenameLine(line);
				if (filename) {
					res.name = filename;
					res.filename = absoluteFilename(this.rootPath, filename);
					res.ln = +ln;
				}

				// Check contents for issues
				if (/^exception/.test(line)) {
					// xxx: investigate if this is already handled
				//	res.exception = true;
				}

				if (/^Debugged program terminated/.test(line)) {
					res.finished = true;
				}

				if (/Use 'q' to quit or 'R' to restart\./.test(line)) {
					res.finished = true;
				}

				if (/^Execution of (\S+) aborted due to compilation errors\.$/.test(line)) {
					res.exception = true;
				}

				if (RX.codeErrorSyntax.test(line)) {
					const parts = line.match(RX.codeErrorSyntax);
					if (parts) {
						const [, filename, ln, near] = parts;
						res.errors.push({
							name: filename,
							filename: absoluteFilename(this.rootPath, filename),
							ln: +ln,
							message: line,
							near: near,
							type: 'SYNTAX',
						});
					}
				}

				// Undefined subroutine &main::functionNotFound called at broken_code.pl line 10.
				if (RX.codeErrorRuntime.test(line)) {
					res.exception = true;
					const parts = line.match(RX.codeErrorRuntime);
					if (parts) {
						const [, near, filename, ln] = parts;
						res.errors.push({
							name: filename,
							filename: absoluteFilename(this.rootPath, filename),
							ln: +ln,
							message: line,
							near: near,
							type: 'RUNTIME',
						});
					}
				}

			}
		});

		if (res.finished) {
			// Close the connection to perl debugger
			this.perlDebugger.kill();
		}

		if (res.exception) {
			this.emit('perl-debug.exception', res);
		} else if (res.finished) {
			this.emit('perl-debug.termination', res);
		}

		this.logRequestResponse(res);

		return res;
	}

	private async launchRequestTerminal(
		filename: string,
		cwd: string,
		args: string[] = [],
		options:LaunchOptions = {},
		session: PerlDebugSession
	): Promise<void> {

		this.isRemote = false;
		this.logOutput(`Launching program in terminal and waiting`);

		// NOTE(bh): `localhost` is hardcoded here to ensure that for
		// local debug sessions, the port is not exposed externally.
		const bindHost = 'localhost';

		this.perlDebugger = new RemoteSession(0, bindHost);

		this.logOutput(this.perlDebugger.title());

		// The RemoteSession will listen on a random available port,
		// and since we need to connect to that port, we have to wait
		// for it to become available.
		await new Promise(
			resolve => this.perlDebugger.on("listening", res => resolve(res))
		);

		const response = await new Promise((resolve, reject) => {
			session.runInTerminalRequest({
				kind: (
					options.console === "integratedTerminal"
						? "integrated"
						: "external"
				),
				cwd: cwd,
				args: [options.exec, "-d", filename].concat(options.args),
				env: {
					...options.env,

					// TODO(bh): maybe merge user-specified options together
					// with the RemotePort setting we need?
					PERLDB_OPTS:
						`RemotePort=${bindHost}:${this.perlDebugger.port}`,
				}
			}, 5000, response => {
				if (response.success) {
					resolve(response);
				} else {
					reject(response);
				}
			});
		});

	}

	private async launchRequestNone(
		filename: string,
		cwd: string,
		args: string[] = [],
		options:LaunchOptions = {}
	): Promise<void> {

		const bindHost = 'localhost';

		this.isRemote = false;
		this.perlDebugger = new RemoteSession(0, bindHost);

		this.logOutput(this.perlDebugger.title());

		await new Promise(
			resolve => this.perlDebugger.on("listening", res => resolve(res))
		);

		this.debuggee = new LocalSession(filename, cwd, args, {
			...options,
			env: {
				...options.env,
				// TODO(bh): maybe merge user-specified options together
				// with the RemotePort setting we need?
				PERLDB_OPTS:
					`RemotePort=${bindHost}:${this.perlDebugger.port}`,
			}
		});

	}

	async launchRequest(
		filename: string,
		cwd: string,
		args: string[] = [],
		options:LaunchOptions = {},
		session: PerlDebugSession
	): Promise<RequestResponse> {

		this.rootPath = cwd;
		this.filename = filename;
		this.currentfile = filename;
		const sourceFile = filename;

		this.logDebug(`Platform: ${process.platform}`);

		Object.keys(options.env || {}).forEach(key => {
			this.logDebug(`env.${key}: "${options.env[key]}"`);
		});

		// Verify file and folder existence
		// xxx: We can improve the error handling

		// FIXME(bh): does it make sense to have a source file here when
		// we just create a server for a remote client to connect to? It
		// seems it should be possible to `F5` without specifying a file.

		if (!fs.existsSync(sourceFile)) {
			this.logOutput( `Error: File ${sourceFile} not found`);
		}

		if (cwd && !fs.existsSync(cwd)) {
			this.logOutput( `Error: Folder ${cwd} not found`);
		}

		this.logOutput(`Platform: ${process.platform}`);

		switch (options.console) {

			case "integratedTerminal":
			case "externalTerminal": {

				if (!session.dcSupportsRunInTerminal) {

					// FIXME(bh): better error handling.
					this.logOutput(
						`Error: console:${options.console} unavailable`
					);

					break;

				}

				await this.launchRequestTerminal(
					filename, cwd, args, options, session
				);

				break;
			}

			case "remote": {

				this.logOutput(
					`Waiting for remote debugger to connect on port "${options.port}"`
				);
				this.perlDebugger = new RemoteSession(options.port);
				this.isRemote = true;

				// FIXME(bh): this does not await the listening event since we
				// already know the port number beforehand, and probably we do
				// still wait (due to the streamCatcher perhaps?) for streams
				// to become usable, it still seems weird though to not await.

				break;
			}

			case "none": {

				await this.launchRequestNone(
					filename, cwd, args, options
				);

				break;
			}

			default: {

				// FIXME(bh): better error handling? Perhaps override bad
				// values earlier in `resolveDebugConfiguration`?
				this.logOutput(
					`Error: console: ${options.console} unknown`
				);

				break;
			}

		}

		this.commandRunning = this.perlDebugger.title();

		this.perlDebugger.on('error', (err) => {
			this.logDebug('error:', err);
			this.logOutput( `Error`);
			this.logOutput( err );
			this.logOutput( `DUMP: ${this.perlDebugger.dump()}` );
		});

		// Handle program output
		this.perlDebugger.stdout.on('data', (buffer) => {
			const data = buffer.toString().split('\n');
			this.logData('', data); // xxx: Program output, better formatting/colors?
		});

		this.perlDebugger.on('close', (code) => {
			this.commandRunning = '';
			this.logOutput(`Debugger connection closed`);
			this.emit('perl-debug.close', code);
		});

		const data = await this.streamCatcher.launch(
			this.perlDebugger.stdin,
			this.perlDebugger.stderr
		);

		this.streamCatcher.on('perl-debug.streamcatcher.data', (...x) => {
			this.emit(
				'perl-debug.streamcatcher.data',
				this.perlDebugger.dump(),
				...x
			);
		});

		this.streamCatcher.on('perl-debug.streamcatcher.write', (...x) => {
			this.emit(
				'perl-debug.streamcatcher.write',
				this.perlDebugger.dump(),
				...x
			);
		});

		// NOTE(bh): By default warnings should be shown in the terminal
		// where the debugee's STDERR is shown. However, some versions of
		// Perl default https://rt.perl.org/Ticket/Display.html?id=133875
		// to redirecting warning output into the debugger's STDERR, so
		// we undo that here.
		await this.streamCatcher.request(
			'o warnLevel=0'
		);

		// this.streamCatcher.debug = this.debug;

		// Depend on the data dumper for the watcher
		// await this.streamCatcher.request('use Data::Dumper');
		await this.streamCatcher.request('$DB::single = 1;');

		// NOTE(bh): Since we are no longer connected directly to the
		// debuggee when interacting with the debugger, there is no need
		// to do this anymore. The `$DB::OUT` handle is set to autoflush
		// by `perl5db.pl` already and it does not have an output handle
		// besides of that. Doing this changes the debuggee's autoflush
		// behavior which we should not do if at all avoidable.

		// xxx: Prevent buffering issues ref: https://github.com/raix/vscode-perl-debug/issues/15#issuecomment-331435911
		// await this.streamCatcher.request('$| = 1;');

		// Initial data from debugger
		this.logData('', data.slice(0, data.length-2));

		// While `runInTerminal` is supposed to give us the pid of the
		// spawned `perl -d` process, that does not work very well as of
		// 2019-02. Instead we ask Perl for the host process id. Note
		// that the value is meaningful only if `this.isRemote` is false.
		// For local processes the pid is needed to send `SIGINT` to the
		// debugger, which is supposed to break into the debugger and
		// used to implement the `pauseRequest`.
		this.debuggerPid = parseInt(await this.getExpressionValue('$$'));

		try {
			// Get the version just after
			this.perlVersion = await this.getPerlVersion();
		} catch(ignore) {
			// xxx: We have to ignore this error because it would intercept the true
			// error on windows
		}

		try {
			this.padwalkerVersion = await this.getPadwalkerVersion();
		} catch(ignore) {
			// xxx: Ignore errors - it should not break anything, this is used to
			// inform the user of a missing dependency install of PadWalker
		}

		return this.parseResponse(data);
	}

	async request(command: string): Promise<RequestResponse> {
		return this.parseResponse(await this.streamCatcher.request(command));
	}

	async relativePath(filename: string) {
		return path.relative(this.rootPath, filename || '');
	}

	async setFileContext(filename: string = this.filename) {
		// xxx: Apparently perl DB wants unix path separators on windows so
		// we enforce the unix separator
		const cleanFilename = filename.replace(/\\/g, '/');
		// await this.request(`print STDERR "${cleanFilename}"`);
		const res = await this.request(`f ${cleanFilename}`);
		if (res.data.length) {
			// if (/Already in/.test)
			if (/^No file matching/.test(res.data[0])) {
				throw new Error(res.data[0]);
			}
		}
		this.currentfile = cleanFilename;
		return res;
	}

	async setBreakPoint(ln: number, filename?: string): Promise<RequestResponse> {
		// xxx: We call `b ${filename}:${ln}` but this will not complain
		// about files not found - this might be ok for now
		// await this.setFileContext(filename);
		// const command = filename ? `b ${filename}:${ln}` : `b ${ln}`;
		// const res = await this.request(`b ${ln}`);

		return Promise.all([this.setFileContext(filename), this.request(`b ${ln}`)])
			.then(result => {
				const res = <RequestResponse>result.pop();
				this.logRequestResponse(res);
				if (res.data.length) {
					if (/not breakable\.$/.test(res.data[0])) {
						throw new Error(res.data[0] + ' ' + filename + ':' + ln);
					}
					if (/not found\.$/.test(res.data[0])) {
						throw new Error(res.data[0] + ' ' + filename + ':' + ln);
					}
				}
				return res;
			});
	}

	async getBreakPoints() {
		const res = await this.request(`L b`);
		const breakpoints = {};
		this.logRequestResponse(res);
		let currentFile = 'unknown';
		res.data.forEach(line => {
			if (RX.breakPoint.condition.test(line)) {
				// Not relevant
			} else if (RX.breakPoint.ln.test(line)) {
				const lnX = line.match(RX.breakPoint.ln);
				if (breakpoints[currentFile] && lnX) {
					const ln = +lnX[1];
					if (lnX[1] === `${ln}`) {
						breakpoints[currentFile].push(ln);
					}
				}
			} else if (RX.breakPoint.filename.test(line)) {
				currentFile = line.replace(/:$/, '');
				this.logDebug('GOT FILENAME:', currentFile);
				if (typeof breakpoints[currentFile] === 'undefined') {
					breakpoints[currentFile] = [];
				}
			} else {
				// Dunno
			}
		});

		this.logDebug('BREAKPOINTS:', breakpoints);
		return breakpoints;
	}

	clearBreakPoint(ln: number, filename?: string): Promise<RequestResponse> {
		// xxx: We call `B ${filename}:${ln}` but this will not complain
		// about files not found - not sure if it's a bug or not but
		// the perl debugger will change the main filename to filenames
		// not found - a bit odd
		// await this.setFileContext(filename);
		// const command = filename ? `B ${filename}:${ln}` : `B ${ln}`;
		return Promise.all([this.setFileContext(filename), this.request(`B ${ln}`)])
			.then(results => <RequestResponse>results.pop());
	}

	async clearAllBreakPoints() {
		return await this.request('B *');
	}

	async continue() {
		return await this.request('c');
	}
// Next:
	async next() {
		return await this.request('n');
	}

	async restart() {
		// xxx: We might need to respawn on windows
		return await this.request('R');
	}

	async getVariableReference(name: string): Promise<string> {
		const res = await this.request(`p \\${name}`);
		return res.data[0];
	}

	async getExpressionValue(expression: string): Promise<string> {
		const res = await this.request(`p ${expression}`);
		return res.data.pop();
	}

	private fixLevel(level: number) {
		// xxx: There seem to be an issue in perl debug or PadWalker in/outside these versions on linux
		// The issue is due to differences between perl5db.pl versions, we should use that as a reference instead of
		// using perl/os
		const isBrokenPerl = (this.perlVersion >= '5.022000' || this.perlVersion < '5.018000');
		const isBrokenLinux = process.platform === 'linux' && isBrokenPerl;
		const isBrokenWindows = /^win/.test(process.platform) && isBrokenPerl;
		const fix = isBrokenLinux || isBrokenWindows;
		return fix ? level - 1 : level;
	}

	/**
	 * Prints out a nice indent formatted list of variables with
	 * array references resolved.
	 */
	async requestVariableOutput(level: number) {
		const variables: Variable[] = [];
		const res = await this.request(`y ${this.fixLevel(level)}`);
		const result = [];

		if (/^Not nested deeply enough/.test(res.data[0])) {
			return [];
		}

		if (RX.codeErrorMissingModule.test(res.data[0])) {
			throw new Error(res.data[0]);
		}

		// Resolve all Array references
		for (let i = 0; i < res.data.length; i++) {
			const line = res.data[i];
			if (/\($/.test(line)) {
				const name = line.split(' = ')[0];
				const reference = await this.getVariableReference(name);
				result.push(`${name} = ${reference}`);
			} else if (line !== ')') {
				result.push(line);
			}
		}

		return result;
	}

	async getVariableList(level: number, scopeName?: string): Promise<ParsedVariableScope> {
		const variableOutput = await this.requestVariableOutput(level);
		//console.log('RESOLVED:');
		//console.log(variableOutput);
		return variableParser(variableOutput, scopeName);
	}

	async variableList(scopes): Promise<ParsedVariableScope> {
		// If padwalker not found then tell the user via the variable inspection
		// instead of being empty.
		if (!this.padwalkerVersion) {
			return {
				local_0: [{
					name: 'PadWalker',
					value: 'Not installed',
					type: 'string',
					variablesReference: '0',
				}],
			};
		}

		const keys = Object.keys(scopes);
		let result: ParsedVariableScope = {};

		for (let i = 0; i < keys.length; i++) {
			const name = keys[i];
			const level = scopes[name];
			Object.assign(result, await this.getVariableList(level, name));
		}
		return result;
	}

	async getStackTrace(): Promise<StackFrame[]> {
		const res = await this.request('T');
		const result: StackFrame[] = [];

		res.data.forEach((line, i) => {
			// > @ = DB::DB called from file 'lib/Module2.pm' line 5
			// > . = Module2::test2() called from file 'test.pl' line 12
			const m = line.match(/^(\S+) = (\S+) called from file \'(\S+)\' line ([0-9]+)$/);

			if (m !== null) {
				const [, v, caller, name, ln] = m;
				const filename = absoluteFilename(this.rootPath, name);
				result.push({
					v,
					name,
					filename,
					caller,
					ln: +ln,
				});
			}

		});

		return result;
	}

	async getLoadedFiles(): Promise<string[]> {

		const loadedFiles = await this.getExpressionValue(
			'join "\t", grep { /^_</ } keys %main::'
		);

		return loadedFiles
			.split(/\t/)
			.filter(x => !/^_<\(eval \d+\)/.test(x))
			.map(x => x.replace(/^_</, ''));

	}

	async getSourceCode(perlPath: string): Promise<string> {

		// NOTE: `perlPath` must be a path known to Perl, there is
		// no path translation at this point.

		const escapedPath = perlPath.replace(
			/([\\'])/g,
			'\\$1'
		);

		return decodeURIComponent(
			// Perl stores file source code in `@{main::_<example.pl}`
			// arrays. This retrieves the code in %xx-escaped form to
			// ensure we only get a single line of output. This could
			// perhaps be done generically for all expressions.
			await this.getExpressionValue(
				`sub { local $_ = join("", @{"main::_<@_"});\
				s/([^a-zA-Z0-9\\x{80}-\\x{10FFFF}])/\
				sprintf '%%%02x', ord "\$1"/ge; \$_ }->('${escapedPath}')`
			)
		);

	}

	async watchExpression(expression) {
		// Brute force this a bit...
		return Promise.all([
			this.request(`W ${expression}`),
			this.request(`w ${expression}`),
		])
		.then(res => res.pop());
	}

	async clearAllWatchers() {
		return this.request('W *');
	}

	async getPerlVersion(): Promise<string> {
		return this.getExpressionValue('$]');
	}

	async getPadwalkerVersion(): Promise<string> {
		const res = await this.request(
			'p sub { local $@; eval "require PadWalker; PadWalker->VERSION()" }->()'
		);
		const version = res.data[0];
		if (/^[0-9]+\.?([0-9]?)+$/.test(version)) {
			return version;
		}
	}

	async resolveFilename(filename): Promise<string> {
		const res = await this.request(`p $INC{"${filename}"};`);
		const [ result = '' ] = res.data;
		return result;
	}

	async destroy() {
		if (this.perlDebugger) {
			this.streamCatcher.destroy();
			this.perlDebugger.kill();
			this.perlDebugger = null;
		}
		if (this.debuggee) {
			this.debuggee.kill();
			this.debuggee = null;
		}
	}
}
