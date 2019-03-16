import {join, dirname, sep} from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {spawn} from 'child_process';
import {StreamCatcher} from './streamCatcher';
import * as RX from './regExp';
import { DebugSession } from './session';

import { LocalSession } from './localSession';
import { RemoteSession } from './remoteSession';
import { AttachSession } from './attachSession';

import { PerlDebugSession, LaunchRequestArguments } from './perlDebug';

import { EventEmitter } from 'events';

import { convertToPerlPath } from "./filepath";
import { breakpointParser } from './breakpointParser';
import { platform } from 'os';
import { PerlVersion } from './perlversion';

interface ResponseError {
	filename: string,
	ln: number,
	message: string,
	near: string,
	type: string,
	name: string,
}

interface WatchpointChange {
	expression: string;
	oldValue?: string;
	newValue?: string;
}

interface Variable {
	name: string,
	type: string,
	value: any,
	variablesReference: number,
}

interface StackFrame {
	filename: string,
	caller: string,
	line: number,
	column?: number,
	endLine?: number,
	endColumn?: number,
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
	changes: WatchpointChange[];
	special: string[];
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

export class PerlDebuggerConnection extends EventEmitter {
	public debug: boolean = false;
	public perlDebugger: DebugSession;
	public debuggee?: DebugSession;

	public streamCatcher: StreamCatcher;
	public perlVersion: PerlVersion;
	public padwalkerVersion: string;
	public scopeBaseLevel: number = -1;
	public develVscodeVersion?: string;
	public hostname?: string;
	public commandRunning: string = '';
	public canSignalDebugger: boolean = false;
	public debuggerPid?: number;
	public programBasename?: string;

	private filename?: string;
	private rootPath?: string;

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
			changes: [],
			special: [],
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

				if (/^Daughter DB session started\.\.\./.test(line)) {
					// TODO(bh): `perl5db.pl` is a bit odd here, when using the
					// typical `TERM=xterm perl -d` this is printed in the main
					// console, but with RemotePort set, this seems to launch a
					// new tty and does nothing with it but print this message.
					// Might be a good idea to investigate further.
				}

				if (/^vscode: /.test(line)) {
					res.special.push(line);
				}

				// Collection of known messages that are not handled in any
				// special way and probably need not be handled either. But
				// it might be a good idea to go over them some day and see
				// if they should be surfaced in the user interface.
				//
				// if (/^Loading DB routines from (.*)/.test(line)) {
				// }
				//
				// if (/^Editor support (.*)/.test(line)) {
				// }
				//
				// if (/^Enter h or 'h h' for help, or '.*perldebug' for more help/.test(line)) {
				// }
				//
				// if (/^The old f command is now the r command\./.test(line)) {
				// }
				//
				// if (/^The new f command switches filenames\./.test(line)) {
				// }
				//
				// if (/^No file matching '(.*)' is loaded\./.test(line)) {
				// }
				//
				// if (/^Already in (.*)\./.test(line)) {
				// }
				//
				// if (/^Subroutine (.*) not found\./.test(line)) {
				// }
				//
				// if (/^exec failed: (.*)/.test(line)) {
				// }
				//
				// if (/^(\d+) levels deep in subroutine calls!/.test(line)) {
				// }

				// NOTE: this was supposed to handle when `w $$` triggers,
				// but it turns out `perl5db.pl` prints this to the wrong
				// tty, that is, in the fork() parent, while the change is
				// actually in the child.

				// Watchpoint 0: $example changed:
				if (RX.watchpointChange.test(line)) {
					const parts = line.match(RX.watchpointChange);
					const [, unstableId, expression ] = parts;
					res.changes.push({
						expression: expression,
					});
				}

				if (RX.watchpointOldval.test(line)) {
					const parts = line.match(RX.watchpointOldval);
					const [, oldValue ] = parts;

					// FIXME(bh): This approach for handling watchpoint changes
					// is probably not sound if the expression being watched
					// stringifies as multiple lines. But internally we only
					// use a single watch expression where this is not an issue
					// and for data breakpoints configured through vscode user
					// interface it might be best to wrap expression so that it
					// would not be possible to get multiple lines in return.
					res.changes[res.changes.length - 1].oldValue = oldValue;
				}

				if (RX.watchpointNewval.test(line)) {
					const parts = line.match(RX.watchpointNewval);
					const [, newValue ] = parts;
					res.changes[res.changes.length - 1].newValue = newValue;
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

		// This happens for example because we replaced `DB::postponed`
		// with a function that reports newly loaded sources and subs
		// to us.
		if (res.special.filter(x => /vscode: new loaded source/.test(x)).length) {
			this.emit('perl-debug.new-source');
		}

		if (res.special.filter(x => /vscode: new subroutine/.test(x)).length) {
			this.emit('perl-debug.new-subroutine');
		}

		if (res.finished) {
			// Close the connection to perl debugger. We try to ask nicely
			// here, otherwise we might generate a SIGPIPE signal which can
			// confuse some Perl programs like `prove` during multi-session
			// debugging.
			this.request('q')
				.then(() => this.perlDebugger.kill())
				.catch(() => this.perlDebugger.kill());
		}

		if (res.exception) {
			this.emit('perl-debug.exception', res);
		} else if (res.finished) {
			this.emit('perl-debug.termination', res);
		}

		if (res.changes.length > 0) {
			this.emit('perl-debug.databreak', res);
		}

		// FIXME(bh): v0.5.0 and earlier of the extension treated all the
		// debugger commands the same, as if they return quickly and with
		// a result of some kind. This led to confusion on part of vscode
		// about whether the debuggee is currently running or stopped.
		//
		// We need to send a `StoppedEvent` when the debugger transitions
		// from executing the debuggee to accepting commands from us, and
		// must not send a `StoppedEvent` when we are in the middle of
		// servicing requests from vscode to populate the debug user
		// interface after a `StoppedEvent`, otherwise vscode will enter
		// an infinite loop.
		//
		// So this is a bit of a kludge to do just that. Better would be
		// a re-design of how I/O with the debugger works, like having a
		// `resume(command: string)` method for these special commands,
		// but that probably requires some surgery through streamCatcher.

		if (/^[scnr]\b/.test(res.command)) {
			this.emit('perl-debug.stopped');
		}

		this.logRequestResponse(res);

		return res;
	}

	private async launchRequestAttach(
		args: LaunchRequestArguments
	): Promise<void> {

		const bindHost = 'localhost';

		this.canSignalDebugger = false;

		this.perlDebugger = new AttachSession(args.port, bindHost);

		await new Promise(
			resolve => this.perlDebugger.on("connect", res => resolve(res))
		);

	}

	private async launchRequestTerminal(
		args: LaunchRequestArguments,
		session: PerlDebugSession
	): Promise<void> {

		this.canSignalDebugger = true;
		this.logOutput(`Launching program in terminal and waiting`);

		// NOTE(bh): `localhost` is hardcoded here to ensure that for
		// local debug sessions, the port is not exposed externally.
		const bindHost = 'localhost';

		this.perlDebugger = new RemoteSession(
			0,
			bindHost,
			args.sessions
		);

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
					args.console === "integratedTerminal"
						? "integrated"
						: "external"
				),
				cwd: args.root,
				args: [
					args.exec,
					...args.execArgs,
					"-d",
					args.program,
					...args.args
				],
				env: {
					...args.env,

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
		args: LaunchRequestArguments
	): Promise<void> {

		const bindHost = 'localhost';

		this.canSignalDebugger = true;
		this.perlDebugger = new RemoteSession(
			0,
			bindHost,
			args.sessions
		);

		this.logOutput(this.perlDebugger.title());

		await new Promise(
			resolve => this.perlDebugger.on("listening", res => resolve(res))
		);

		this.debuggee = new LocalSession({
			...args,
			program: args.program,
			root: args.root,
			args: args.args,
			env: {
				...args.env,
				// TODO(bh): maybe merge user-specified options together
				// with the RemotePort setting we need?
				PERLDB_OPTS:
					`RemotePort=${bindHost}:${this.perlDebugger.port}`,
			}
		});

	}

	private async launchRequestRemote(
		args: LaunchRequestArguments
	): Promise<void> {

		// FIXME(bh): Logging the port here makes no sense when the
		// port is set to zero (which causes random one to be selected)

		this.logOutput(
			`Waiting for remote debugger to connect on port "${args.port}"`
		);

		this.perlDebugger = new RemoteSession(
			args.port,
			'0.0.0.0',
			args.sessions
		);
		this.canSignalDebugger = false;

		// FIXME(bh): this does not await the listening event since we
		// already know the port number beforehand, and probably we do
		// still wait (due to the streamCatcher perhaps?) for streams
		// to become usable, it still seems weird though to not await.

	}

	async launchSession(
		args: LaunchRequestArguments,
		session: PerlDebugSession
	) {

		switch (args.console) {

			case "integratedTerminal":
			case "externalTerminal": {

				if (!session || !session.dcSupportsRunInTerminal) {

					// FIXME(bh): better error handling.
					this.logOutput(
						`Error: console:${args.console} unavailable`
					);

					break;

				}

				await this.launchRequestTerminal( args, session );

				break;
			}

			case "remote": {
				await this.launchRequestRemote(args);
				break;
			}

			case "none": {
				await this.launchRequestNone(args);
				break;
			}

			case "_attach": {
				await this.launchRequestAttach(args);
				break;
			}

			default: {

				// FIXME(bh): better error handling? Perhaps override bad
				// values earlier in `resolveDebugConfiguration`?
				this.logOutput(
					`Error: console: ${args.console} unknown`
				);

				break;
			}

		}

	}

	private async canSignalHeuristic(): Promise<boolean> {

		// Execution control requests such as `terminate` and `pause` are
		// at least in part implemented through sending signals to the
		// debugger/debuggee process. That can only be done on the local
		// system. But users might use remote debug configurations on the
		// local machine, in which case it would be a shame if `pause`
		// did not work.
		//
		// There is no easy and portable way to generate something like a
		// globally unique process identifier that could be used to make
		// sure we actually are on the same system, but a heuristic might
		// be fair enough. If it looks as though Perl can signal us, and
		// we can signal Perl, and we think we run on systems with the
		// same hostname, we simply assume that we in fact do so.
		//
		// On Linux `/proc/sys/kernel/random/boot_id` could be compared,
		// if we and Perl see the same contents, we very probably are on
		// the same system. Similarily, other `/proc/` details could be
		// compared. We cannot use socket address comparisons since the
		// user might have their own forwarding setup in place.

		if (os.hostname() !== this.hostname) {
			return false;
		}

		const debuggerCanSignalUs = await this.getExpressionValue(
			`CORE::kill(0, ${process.pid})`
		);

		if (!debuggerCanSignalUs) {
			return false;
		}

		try {
			process.kill(this.debuggerPid, 0);
		} catch (e) {
			return false;
		}

		return true;
	}

	private getDebuggerFunctionsPath() {

		let plPath = (
			path.dirname(process.argv0)
			+
			'/../debugger-functions.pl'
		);

		// When `EMBED_DEBUG_ADAPTER` in extension.ts is set, `argv0`
		// points to vscode itself instead of our `debugAdapter.ts`.

		// FIXME(bh): Only alternative to get the path to this file,
		// or the extension directory in general, during debugging and
		// when properly installed, seems to be getting a path from a
		// stack trace, which is not very nice and not very portable.

		if (!fs.existsSync(plPath)) {
			plPath = new Error().stack.match(/(\/\S+):\d+:\d+/)[1];
			plPath = path.dirname(plPath) + '/../debugger-functions.pl';
		}

		return plPath;

	}

	private async installSubroutines() {

		// https://metacpan.org/pod/Devel::vscode register a namespace
		// on CPAN for use in this extension. For some features, we have
		// to execute Perl code in the debugger, and sometimes it can be
		// unwieldy to send the whole code to the debugger every time.
		// There are also features that benefit from persisting data on
		// Perl's end. So this installs a couple of subroutines for such
		// features. For these, it is not necessary for users of the
		// extension to install or otherwise load `Devel::vscode`.

		const path = this.getDebuggerFunctionsPath();
		const contents = fs.readFileSync(path).toString();
		const escaped = this.escapeForDoubleQuotes(contents);

		await this.request(
			`eval "${escaped}" unless $Devel::vscode::DEBUGGER_FUNCTIONS`
		);

		// Clear after exec()
		await this.request(
			`%Devel::vscode::_reported_sources = ()`
		);

	}

	async launchRequest(
		args: LaunchRequestArguments,
		session: PerlDebugSession
	): Promise<RequestResponse> {

		this.rootPath = args.root;
		this.filename = args.program;

		this.logDebug(`Platform: ${platform()}`);

		Object.keys(args.env || {}).forEach(key => {
			this.logDebug(`env.${key}: "${args.env[key]}"`);
		});

		// Verify file and folder existence
		// xxx: We can improve the error handling

		// FIXME(bh): does it make sense to have a source file here when
		// we just create a server for a remote client to connect to? It
		// seems it should be possible to `F5` without specifying a file.

		// FIXME(bh): Check needs to account for args.root

		if (!fs.existsSync(args.program)) {
			this.logOutput(`Error: File ${args.program} not found`);
		}

		if (args.root && !fs.existsSync(args.root)) {
			this.logOutput(`Error: Folder ${args.root} not found`);
		}

		this.logOutput(`Platform: ${platform()}`);

		// This is the actual launch
		await this.launchSession(args, session);

		this.commandRunning = this.perlDebugger.title();

		this.perlDebugger.on('error', (err) => {
			this.logDebug('error:', err);
			this.logOutput( `Error`);
			this.logOutput( err );
			this.logOutput( `DUMP: ${this.perlDebugger.title()}` );
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

		this.perlDebugger.on(
			'perl-debug.attachable.listening',
			data => {
				this.emit(
					'perl-debug.attachable.listening',
					data
				);
		});

		this.streamCatcher.removeAllListeners();
		this.streamCatcher.on('perl-debug.streamcatcher.data', (...x) => {
			this.emit(
				'perl-debug.streamcatcher.data',
				this.perlDebugger.title(),
				...x
			);
		});

		this.streamCatcher.on('perl-debug.streamcatcher.write', (...x) => {
			this.emit(
				'perl-debug.streamcatcher.write',
				this.perlDebugger.title(),
				...x
			);
		});

		const data = await this.streamCatcher.launch(
			this.perlDebugger.stdin,
			this.perlDebugger.stderr
		);

		if (args.sessions !== 'single') {

			this.develVscodeVersion = await this.getDevelVscodeVersion();

			if (!this.develVscodeVersion) {

				// Global watch expression that breaks into the debugger when
				// the pid of the process changes; that can only happen right
				// after a fork. This is needed to learn about new children
				// when Devel::vscode is not loaded, see documentation there.

				await this.streamCatcher.request(
					'w $$'
				);

			}

		}

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

		await this.installSubroutines();

		// While `runInTerminal` is supposed to give us the pid of the
		// spawned `perl -d` process, that does not work very well as of
		// 2019-02. Instead we ask Perl for the host process id. Note
		// that the value is meaningful only if `this.isRemote` is false.
		// For local processes the pid is needed to send `SIGINT` to the
		// debugger, which is supposed to break into the debugger and
		// used to implement the `pauseRequest`.
		this.debuggerPid = await this.getDebuggerPid();

		this.programBasename = await this.getProgramBasename();
		this.hostname = await this.getHostname();

		// Try to find out if debug adapter and debugger run on the same
		// machine and can signal each other even if the launchRequest is
		// configured for remote debugging or an attach session, so users
		// can pause and terminate processes through the user interface.
		if (!this.canSignalDebugger) {
			this.canSignalDebugger = await this.canSignalHeuristic();
		}

		try {
			// Get the version just after
			this.perlVersion = new PerlVersion(await this.getPerlVersion());
		} catch(ignore) {
			// xxx: We have to ignore this error because it would intercept the true
			// error on windows
		}

		try {
			this.padwalkerVersion = await this.getPadwalkerVersion();
			this.scopeBaseLevel = await this.getVariableBaseLevel();
		} catch(ignore) {
			// xxx: Ignore errors - it should not break anything, this is used to
			// inform the user of a missing dependency install of PadWalker
		}

		await this.installSubroutines();

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
		// we enforce the unix separator. Also remove relative path steps;
		// if the debugger does not know about a file path literally, it
		// will try to find a matching file through a regex match, so this
		// increases the odds of finding the right file considerably. An
		// underlying issue here is that we cannot always use resolved
		// paths because we do not know what a relative path is relative
		// to.
		const cleanFilename = convertToPerlPath(filename);

		// await this.request(`print STDERR "${cleanFilename}"`);
		const res = await this.request(`f ${cleanFilename}`);
		if (res.data.length) {
			// if (/Already in/.test)
			if (/^No file matching/.test(res.data[0])) {
				throw new Error(res.data[0]);
			}
		}
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
		this.logRequestResponse(res);
		const breakpoints = breakpointParser(res.data);
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

	async getLexicalVariables(frameId: number): Promise<any[]> {
		const data = await this.getExpressionValue(
			`Devel::vscode::_get_lexical_symbols_json(${frameId})`
		);

		return JSON.parse(data);
	}

	async getPackageVariables(pkg: string): Promise<any[]> {

		const data = await this.getExpressionValue(
			`Devel::vscode::_get_package_symbols_json('${
				this.escapeForSingleQuotes(pkg)
			}')`
		);

		return JSON.parse(data);
	}

	async getExprVariables(expr: string): Promise<any[]> {

		const data = await this.getExpressionValue(
			`Devel::vscode::_get_element_symbols_json(${expr})`
		);

		return JSON.parse(data);

	}

	async getExpressionValue(expression: string): Promise<string> {

		// NOTE(bh): It is important to force a string context here,
		// otherwise we might get multiple values from the expression,
		// or in case of overloaded objects, might get a non-string
		// value. It might then make sense to have other methods that
		// force different contexts.
		//
		// Users should not be able to notice what we do here, so we
		// temporarily disable the debugger for the duration of the
		// request. When users specifically ask to break inside the
		// debugger, like with `w $DB::sub` or `w $DB::package`, they
		// might still intercept us here; that is probbaly ultimately
		// a problem in `perl5db.pl` which is also affected.

		const res = await this.request(
			`; { local *DB::DB = sub {}; print { \$DB::OUT } ( '' . (${
				expression
			}) ) }`
		);

		return res.data.pop();
	}

	async getStackTrace(): Promise<StackFrame[]> {

		const data = await this.getExpressionValue(
			`Devel::vscode::_get_callers_json(0)`
		);

		const frames = JSON.parse(data).map(item => {

			const [
				pkg, filename, line, sub, hasargs, wantarray,
				evaltext, is_require, hints, bitmask, hinthash
			] = item;

			const frame: StackFrame = {
				line: parseInt(line, 10),
				caller: sub,
				filename: filename,
			};

			return frame;

		});

		frames.forEach((item, ix) => {
			item.caller = frames[ix+1]
				? frames[ix+1].caller
				: '(anonymous code)';
		});

		return frames;

	}

	async getLoadedFiles(): Promise<string[]> {

		const loadedFiles = await this.getExpressionValue(
			`defined &Devel::vscode::_get_unreported_sources_json ${
				'' // just for a line wrap
			} ? Devel::vscode::_get_unreported_sources_json() : "[]"`
		);

		return JSON.parse(loadedFiles || '[]')
			.filter(x => !/^_<\(eval \d+\)/.test(x))
			.filter(x => x.length > 0)
			.map(x => x.replace(/^_</, ''));

	}

	async getSourceCode(perlPath: string): Promise<string> {

		// NOTE: `perlPath` must be a path known to Perl, there is
		// no path translation at this point.

		const escapedPath = this.escapeForSingleQuotes(
			perlPath
		);

		return JSON.parse(
			await this.getExpressionValue(
				`Devel::vscode::_get_source_code_json('${escapedPath}')`
			)
		).join('');

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
		const version = await this.getExpressionValue(
			'PadWalker->VERSION()'
		);
		if (/^[0-9]+\.?([0-9]?)+$/.test(version)) {
			return version;
		}
	}

	async getVariableBaseLevel() {
		const limitOfScope = /^Not nested deeply enough/;
		const {data: [level1]} = await this.request('y 1'); // 5.22
		const {data: [level2]} = await this.request('y 2'); // 5.20
		if (limitOfScope.test(level1)) {
			return 0;
		}
		if (limitOfScope.test(level2)) {
			return 1;
		}
		// apparently we didn't find the base level?
		return -1;
	}

	async getDebuggerPid(): Promise<number> {
		return parseInt(await this.getExpressionValue(
			'$$'
		), 10);
	}

	async getHostname(): Promise<string> {
		return await this.getExpressionValue(
			'Sys::Hostname::hostname()'
		);
	}

	async getDevelVscodeVersion(): Promise<string | undefined> {
		return await this.getExpressionValue(
			'$Devel::vscode::VERSION'
		);
	}

	async getProgramBasename(): Promise<string> {
		const name = await this.getExpressionValue(
			'$0'
		);
		return (name || '').replace(/.*[\/\\](.*)/, '$1');
	}

	public getThreadName(): string {
		return `${this.programBasename} (pid ${
			this.debuggerPid} on ${
				this.hostname})`;
	}

	async resolveFilename(filename): Promise<string> {
		return await this.getExpressionValue(
			`$INC{"${this.escapeForDoubleQuotes(filename)}"};
		`);
	}

	public escapeForSingleQuotes(unescaped: string): string {
		return unescaped.replace(
			/([\\'])/g,
			'\\$1'
		);
	}

	public escapeForDoubleQuotes(unescaped: string): string {
		return unescaped.replace(
			/([^a-zA-Z0-9])/ug,
			(whole, elem) => `\\x{${elem.codePointAt(0).toString(16)}}`
		);
	}


	public terminateDebugger(): boolean {

		if (this.canSignalDebugger) {

			// Send SIGTERM to the `perl -d` process on the local system.
			process.kill(this.debuggerPid, 'SIGTERM');
			return true;

		} else {

			return false;
		}

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
