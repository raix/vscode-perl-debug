import {join, dirname, sep} from 'path';
import * as fs from 'fs';
import {spawn} from 'child_process';
import {StreamCatcher} from './streamCatcher';
import * as RX from './regExp';
import variableParser, { ParsedVariable, ParsedVariableScope } from './variableParser';
import { DebugSession, LaunchOptions } from './session';
import { LocalSession } from './localSession';
import { RemoteSession } from './remoteSession';

interface ResponseError {
	filename: string,
	ln: number,
	message: string,
	near: string,
	type: string,
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

function relativeFilename(root: string, filename: string): string {
	// If already relative to root
	if (fs.existsSync(join(root, filename))) {
		return filename;
	}
	// Try to create relative filename
	// ensure trailing separator in root path eg. /foo/
	const relName = filename.replace(root, '').replace(/^[\/|\\]/, '');
	if (fs.existsSync(join(root, relName))) {
		return relName;
	}

	// We might need to add more cases
	return filename;
}

export class perlDebuggerConnection {
	public debug: boolean = false;
	public perlDebugger: DebugSession;
	public streamCatcher: StreamCatcher;
	public perlVersion: string;
	public padwalkerVersion: string;
	public commandRunning: string = '';

	private filename?: string;
	private rootPath?: string;
	private currentfile?: string;

	public onOutput: Function | null = null;
	public onError: Function | null = null;
	public onClose: Function | null = null;
	public onException: Function | null = null;
	public onTermination: Function | null = null;

	/**
	 * Pass in the initial script and optional additional arguments for
	 * running the script.
	 */
	constructor() {
		this.streamCatcher = new StreamCatcher();
	}

	async initializeRequest() {}

	logOutput(data: string) {
		if (typeof this.onOutput === 'function') {
			try {
				this.onOutput(data);
			} catch (err) {
				throw new Error(`Error in "onOutput" handler: ${err.message}`);
			}
		}
	}

	logData(prefix: string, data: string[]) {
		data.forEach((val, i) => {
			this.logOutput(`${prefix}${val}`);
		});
	}

	parseResponse(data: string[]): RequestResponse {
		const res = {
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
				if (dbX) res.db = dbX[1];
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

		if (res.exception || res.finished) {
			// Close the connection to perl debugger
			this.perlDebugger.kill();
		}

		if (res.exception) {
			if (typeof this.onException === 'function') {
				try {
					this.onException(res)
				} catch (err) {
					throw new Error(`Error in "onException" handler: ${err.message}`);
				}
			}
		} else if (res.finished) {
			if (typeof this.onTermination === 'function') {
				try {
					this.onTermination(res)
				} catch (err) {
					throw new Error(`Error in "onTermination" handler: ${err.message}`);
				}
			}
		}

		if (this.debug) console.log(res);

		if (res.exception) {
			throw res;
		}

		return res;
	}

	async launchRequest(filename: string, cwd: string, args: string[] = [], options:LaunchOptions = {}): Promise<RequestResponse> {
		this.rootPath = cwd;
		this.filename = filename;
		this.currentfile = filename;
		const sourceFile = filename;

		if (this.debug) console.log(`Platform: ${process.platform}`);
		if (this.debug && options.env) {
			const keys = Object.keys(options.env);
			keys.forEach(key => {
				console.log(`env.${key}: "${options.env[key]}"`);
			});
		}

		// Verify file and folder existence
		// xxx: We can improve the error handling
		if (!fs.existsSync(sourceFile)) this.logOutput( `Error: File ${sourceFile} not found`);
		if (cwd && !fs.existsSync(cwd)) this.logOutput( `Error: Folder ${cwd} not found`);

		this.logOutput(`Platform: ${process.platform}`);
		this.logOutput(`Launch "perl -d ${sourceFile}" in "${cwd}"`);


		// xxx: add failure handling
		if (!options.port) {
			// If no port is configured then run this locally in a fork
			this.perlDebugger = new LocalSession(filename, cwd, args, options);
			this.logOutput(this.perlDebugger.title());
		} else {
			// If port is configured then use the remote session.
			this.logOutput(`Waiting for remote debugger to connect on port "${options.port}"`);
			this.perlDebugger = new RemoteSession(options.port);
		}

		this.commandRunning = this.perlDebugger.title();

		this.perlDebugger.on('error', (err) => {
			if (this.debug) console.log('error:', err);
			this.logOutput( `Error`);
			this.logOutput( err );
			this.logOutput( `DUMP: ${this.perlDebugger.dump()}` );
		});

		this.streamCatcher.launch(this.perlDebugger.stdin, this.perlDebugger.stderr);

		// this.streamCatcher.debug = this.debug;

		// Handle program output
		this.perlDebugger.stdout.on('data', (buffer) => {
			const data = buffer.toString().split('\n');
			this.logData('', data); // xxx: Program output, better formatting/colors?
		});

		this.perlDebugger.on('close', (code) => {
			this.commandRunning = '';
			if (this.streamCatcher.ready) {
				this.logOutput(`Debugger connection closed`);
			} else {
				this.logOutput(`Could not connect to debugger, connection closed`);
			}
			if (typeof this.onClose === 'function') {
				try {
					this.onClose(code);
				} catch (err) {
					throw new Error(`Error in "onClose" handler: ${err.message}`);
				}
			}
		});

		// Depend on the data dumper for the watcher
		// await this.streamCatcher.request('use Data::Dumper');
		await this.streamCatcher.request('$DB::single = 1;');

		// xxx: Prevent buffering issues ref: https://github.com/raix/vscode-perl-debug/issues/15#issuecomment-331435911
		await this.streamCatcher.request('$| = 1;');

		// if (options.port) {
			// xxx: This will mix stderr and stdout into one dbout
			// await this.streamCatcher.request('select($DB::OUT);');
		// }

		// Listen for a ready signal
		const data = await this.streamCatcher.isReady()
		this.logData('', data.slice(0, data.length-2));

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
		await this.streamCatcher.isReady();
		return this.parseResponse(await this.streamCatcher.request(command));
	}

	async relativePath(filename: string) {
		await this.streamCatcher.isReady();
		return filename && filename.replace(`${this.rootPath}${sep}`, '');
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
				if (this.debug) console.log(res);
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
		if (this.debug) console.log(res);
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
				if (this.debug) console.log('GOT FILENAME:', currentFile);
				if (typeof breakpoints[currentFile] === 'undefined') {
					breakpoints[currentFile] = [];
				}
			} else {
				// Dunno
			}
		});

		if (this.debug) console.log('BREAKPOINTS:', breakpoints);
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
		const res = await this.request(`print STDERR \\${name}`);
		return res.data[0];
	}

	async getExpressionValue(expression: string): Promise<string> {
		const res = await this.request(`print STDERR ${expression}`);
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
		const res = await this.request('p $]');
		return res.data[0];
	}

	async getPadwalkerVersion(): Promise<string> {
		const res = await this.request('print $DB::OUT eval { require PadWalker; PadWalker->VERSION() }');
		const version = res.data[1];
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
	}
}
