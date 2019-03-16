/// <reference types="node" />

import {
	Logger, logger,
	DebugSession, LoggingDebugSession,
	InitializedEvent, TerminatedEvent, StoppedEvent, BreakpointEvent, OutputEvent, Event,
	ContinuedEvent,
	Thread, StackFrame, Scope, Source, Handles, Breakpoint, Variable,
	LoadedSourceEvent
} from 'vscode-debugadapter';
import {DebugProtocol} from 'vscode-debugprotocol';
import {readFileSync} from 'fs';
import {basename, dirname, join} from 'path';
import {spawn, ChildProcess} from 'child_process';
const { Subject } = require('await-notify');
import { PerlDebuggerConnection, RequestResponse } from './adapter';

/**
 * This interface should always match the schema found in the perl-debug extension manifest.
 */
export interface LaunchRequestArguments extends DebugProtocol.LaunchRequestArguments {
	/** Perl binary */
	exec: string;
	/** Binary executable arguments */
	execArgs: string[],
	/** Workspace path */
	root: string,
	/** An absolute path to the program to debug. */
	program: string;
	/** Automatically stop target after launch. If not specified, target does not stop. */
	stopOnEntry?: boolean;
	/** List of includes */
	inc?: string[];
	/** List of program arguments */
	args?: string[];
	/** enable logging the Debug Adapter Protocol */
	trace?: boolean;
	/** env variables when executing debugger */
	env?: {};
	/** port for debugger to listen for remote debuggers */
	port?,
	/** Where to launch the debug target */
	console?: string,
	/** Log raw I/O with debugger in output channel */
	debugRaw?: boolean,
	/** Log debugging messages in output channel */
	debugLog?: boolean,
	/** How to handle forked children or multiple connections */
	sessions?: string,
}

class PerlVariable {
	parent?: number;
	step?: string;
	constructor(parent?: number, step?: string) {
		this.parent = parent;
		this.step = step;
	}
}

class PerlVariableRoot extends PerlVariable {
	scope: string;
	frameId: number;
	pkg: string;
	constructor(scope: string, frameId?: number, pkg?: string) {
		super();
		this.scope = scope;
		this.frameId = frameId;
		this.pkg = pkg;
	}
}

class PerlVariableMap {

	_next: number = 1;
	_data: Map<number, PerlVariable> = new Map<number, PerlVariable>();

	public clear() {
		// NOTE: _next is never reset to prevent accidental re-use of IDs
		this._data.clear();
	}

	public get(variablesReference: number) {
		return this._data.get(variablesReference);
	}

	public create(variable: PerlVariable) {
		this._data.set(this._next, variable);
		return this._next++;
	}

	public expr(variableReference: number): string {

		const map = this._data;

		const g = function*(v: number) {
			while (v) {
				const perlVar = map.get(v);
				if (perlVar.step !== '' && perlVar.step !== undefined) {
					yield perlVar.step;
				}
				v = perlVar.parent;
			}
		}

		// NOTE(bh): Older versions of Perl do not support the postfix
		// dereference syntax `->$*` to dereference (scalar) references.
		// Therefore such steps are mapped to prefix syntax `${ ... }`,
		// wrapping the expression up to that point.

		const result = Array
			.from(g(variableReference))
			.reverse()
			.reduce((prev, current, idx, arr) => {
				return current === '->$*' ? `\$\{${prev}\}` : prev + current;
			}, "");

		return result;

	}

}

export class PerlDebugSession extends LoggingDebugSession {
	private static THREAD_ID = 1;

	private _breakpointId = 1000;

	private _breakPoints = new Map<string, DebugProtocol.Breakpoint[]>();

	private _functionBreakPoints: Map<string, DebugProtocol.Breakpoint>
		= new Map<string, DebugProtocol.Breakpoint>();

	private _loadedSources = new Map<string, Source>();

	private _variableMap = new PerlVariableMap();

	public dcSupportsRunInTerminal: boolean = false;
	public dcSupportsVariablePaging: boolean = false;

	private adapter: PerlDebuggerConnection;

	public constructor() {
		super('perl_debugger.log');

		this.adapter = new PerlDebuggerConnection();

		this.setDebuggerLinesStartAt1(false);
		this.setDebuggerColumnsStartAt1(false);
	}

	private rootPath: string = '';

	private _configurationDone = new Subject();

	private sendStoppedEvent(reason: string) {

		// https://github.com/Microsoft/debug-adapter-protocol/issues/35
		// It is not really clear how long and to what end established
		// `variablesReference` values should stay valid, but as a rule
		// of thumb, when the stack frame has changed, the scopes and
		// associated variables probably have changed. We cannot keep
		// old variables around indefinitely, so we clear them here.

		this._variableMap.clear();

		this.sendEvent(
			new StoppedEvent(reason, PerlDebugSession.THREAD_ID)
		);

	}

	protected initializeRequest(response: DebugProtocol.InitializeResponse, args: DebugProtocol.InitializeRequestArguments): void {

		this.dcSupportsRunInTerminal = !!args.supportsRunInTerminalRequest;
		this.dcSupportsVariablePaging = !!args.supportsVariablePaging;

		this.adapter.on('perl-debug.output', (text) => {
			this.sendEvent(new OutputEvent(`${text}\n`));
		});

		this.adapter.on('perl-debug.exception', (res) => {
			// xxx: for now I need more info, code to go away...
			const [ error ] = res.errors;
			this.sendEvent(
				new OutputEvent(`${error.message}`, 'stderr')
			);
		});

		this.adapter.on('perl-debug.termination', (x) => {
			this.sendEvent(new TerminatedEvent());
		});

		this.adapter.on('perl-debug.stopped', (x) => {

			// FIXME(bh): `breakpoint` is not always correct here.
			this.sendStoppedEvent('breakpoint');

		});

		this.adapter.on('perl-debug.close', (x) => {
			this.sendEvent(new TerminatedEvent());
		});

		this.adapter.on('perl-debug.new-source', () => {

			// FIXME(bh): There is probably a better way to re-use the code
			// in that function that does not require setting up a malformed
			// object here, but this seems good enough for the moment.
			this.loadedSourcesRequestAsync(
				{} as DebugProtocol.LoadedSourcesResponse,
				{}
			);

		});

		this.adapter.on(
			'perl-debug.attachable.listening',
			data => {
				this.sendEvent(
					new Event(
						'perl-debug.attachable.listening', data
					)
				);
			}
		);

		this.adapter.initializeRequest()
			.then(() => {
				// This debug adapter implements the configurationDoneRequest.
				response.body.supportsConfigurationDoneRequest = true;

				// make VS Code to use 'evaluate' when hovering over source
				response.body.supportsEvaluateForHovers = true;

				response.body.supportsFunctionBreakpoints = true;

				response.body.supportsLoadedSourcesRequest = true;

				response.body.supportsTerminateRequest = true;

				response.body.supportsSetVariable = true;

				this.sendResponse(response);

			});
	}

	/**
	 * Called at the end of the configuration sequence.
	 * Indicates that all breakpoints etc. have been sent to the DA and that the 'launch' can start.
	 */
	protected configurationDoneRequest(response: DebugProtocol.ConfigurationDoneResponse, args: DebugProtocol.ConfigurationDoneArguments): void {
		super.configurationDoneRequest(response, args);

		// notify the launchRequest that configuration has finished
		this._configurationDone.notify();
	}

	private stepAfterFork(
		sessions: string,
		launchResponse: RequestResponse
	) {

		const stoppedInForkWrapper =
			/^Devel::vscode::_fork/.test(launchResponse.data[0] || "");

		const pidsInDebuggerPrompt =
			/^\[pid=/.test(launchResponse.db);

		if (stoppedInForkWrapper && sessions === 'break') {
			// step out of the wrapper
			this.adapter.request('s');
		}

		if (sessions === 'watch') {

			this.adapter.request('c');
			// FIXME: should only be sent when `c` is actually sent to debugger
			this.sendEvent(
				new ContinuedEvent(PerlDebugSession.THREAD_ID)
			);

		} else if (sessions === 'break') {

			this.sendStoppedEvent("postfork");

		}

	}

	protected async launchRequest(
		response: DebugProtocol.LaunchResponse,
		args: LaunchRequestArguments
	) {

		this.rootPath = args.root;

		logger.setup(args.trace ? Logger.LogLevel.Verbose : Logger.LogLevel.Stop, false);

		this.adapter.removeAllListeners('perl-debug.streamcatcher.data');
		this.adapter.removeAllListeners('perl-debug.streamcatcher.write');

		if (args.debugRaw) {
			this.adapter.on('perl-debug.streamcatcher.data', (...x) => {
				this.sendEvent(new Event('perl-debug.streamcatcher.data', x));
			});

			this.adapter.on('perl-debug.streamcatcher.write', (...x) => {
				this.sendEvent(new Event('perl-debug.streamcatcher.write', x));
			});
		}

		this.adapter.removeAllListeners('perl-debug.debug');
		if (args.debugLog) {
			this.adapter.on('perl-debug.debug', (...x) => {
				this.sendEvent(new Event('perl-debug.debug', x));
			});
		}

		// TODO(bh): If the user manually launches two debug sessions in
		// parallel, this would clear output from one of the sessions
		// when starting the other one. That is not ideal.
		if (args.console !== '_attach') {
			this.sendEvent(new Event('perl-debug.streamcatcher.clear'));
		}

		const launchResponse = await this.adapter.launchRequest(
			args,
			// Needs a reference to the session for `runInTerminal`
			this
		);

		await this.loadedSourcesRequest(
			{} as DebugProtocol.LoadedSourcesResponse,
			{}
		);

		// NOTE(bh): This extension used to send the `InitializedEvent`
		// at the beginning of the `initializeRequest`. That was taken
		// as a signal that we can accept configurations right away, but
		// we actually need to talk to the debugger to set breakpoints
		// without buffering them. Fixed in part thanks to the help in
		// https://github.com/Microsoft/vscode/issues/69317

		this.sendEvent(new InitializedEvent());

		// With the event sent vscode should now send us breakpoint and
		// other configuration requests and signals us that it done doing
		// so with a `configurationDoneRequest`, so we wait here for it.
		await this._configurationDone.wait(2000);

		if (args.console === '_attach') {

			this.stepAfterFork(args.sessions, launchResponse);

		} else if (args.stopOnEntry) {

			this.sendResponse(response);

			// we stop on the first line
			this.sendStoppedEvent("entry");
		} else {
			// we just start to run until we hit a breakpoint or an exception
			this.continueRequest(
				<DebugProtocol.ContinueResponse>response,
				{
					threadId: PerlDebugSession.THREAD_ID
				}
			);
		}

	}

	protected threadsRequest(response: DebugProtocol.ThreadsResponse): void {

		// NOTE(bh): vscode actually shows the thread name in the user
		// interface during multi-session debugging, at least until
		// https://github.com/Microsoft/vscode/issues/69752 is addressed,
		// so this tries to make a pretty name for it.

		// NOTE(bh): "The use of interpreter-based threads in perl is
		// officially discouraged." -- `perldoc threads`. This extension
		// does not support them in any way, so we only ever report one
		// thread per adapter instance.

		response.body = {
			threads: [
				new Thread(
					PerlDebugSession.THREAD_ID,
					this.adapter.getThreadName()
				)
			]
		};

		this.sendResponse(response);

	}


/**
 * TODO
 *
 * if possible:
 *
 * * step out
 * * step back
 * * reverse continue
 * * data breakpoints (https://github.com/raix/vscode-perl-debug/issues/4)
 */

	/**
	 * Reverse continue
	 */
	protected reverseContinueRequest(response: DebugProtocol.ReverseContinueResponse, args: DebugProtocol.ReverseContinueArguments) : void {
		this.sendEvent(new OutputEvent(`ERR>Reverse continue not implemented\n\n`));

		// Perl does not support this.

		response.success = false;
		this.sendResponse(response);
 	}

	/**
	 * Step back
	 */
	protected stepBackRequest(response: DebugProtocol.StepBackResponse, args: DebugProtocol.StepBackArguments): void {
		this.sendEvent(new OutputEvent(`ERR>Step back not implemented\n`));

		// Perl does not support this.

		response.success = false;
		this.sendResponse(response);
	}



	private async checkSignaling(): Promise<boolean> {

		if (!this.adapter.canSignalDebugger) {
			return false;
		}

		// When we get here, it looks as though we run on the same host
		// and our user also has a process with a process identifier that
		// matches the one we got from the debugger. Check if we can make
		// the debugger send us a SIGINT. If that works, we assume that
		// the other direction works aswell. In the unlikely worst case,
		// the signal goes to the wrong process on a different machine.

		const result = Promise.race<boolean>([
			new Promise<boolean>(resolve => {
				process.once('SIGINT', () => resolve(true))
			}),
			new Promise<boolean>((resolve, reject) => {
				setTimeout(() => resolve(false), 200)
			})
		]);

	  await this.adapter.getExpressionValue(
			`CORE::kill('INT', ${process.pid})`
	  );

	  return result;
	}

	protected async disconnectRequest(
		response: DebugProtocol.DisconnectResponse,
		args: DebugProtocol.DisconnectArguments
	): Promise<void> {

		this.adapter.terminateDebugger()
		await this.adapter.destroy();
		this.sendResponse(response);

	}

	protected async terminateRequest(
		response: DebugProtocol.TerminateResponse,
		args: DebugProtocol.TerminateArguments
	): Promise<void> {

		if (this.adapter.terminateDebugger()) {

			// FIXME(bh): Unsure whether to do this here.
			await this.adapter.destroy();

			this.sendResponse(response);

		} else {

			response.success = false;
			response.body = {
				error: {
					message: 'Cannot send SIGTERM to debugger on remote system'
				}
			};
			this.sendResponse(response);

		}

	}

	protected pauseRequest(response: DebugProtocol.PauseResponse, args: DebugProtocol.PauseArguments): void {

		if (!this.adapter.canSignalDebugger) {
			response.success = false;
			response.body = {
				error: {
					message: 'Cannot send SIGINT to debugger on remote system'
				}
			};
			this.sendResponse(response);

		} else {

			// Send SIGINT to the `perl -d` process on the local system.
			process.kill(this.adapter.debuggerPid, 'SIGINT');
			this.sendResponse(response);

		}

	}

	private isValidFunctionName(name: string): boolean {
		return /^[':A-Za-z_][':\w]*$/.test(name);
	}

	private async setFunctionBreakPointAsync(
		bp: DebugProtocol.FunctionBreakpoint
	): Promise<DebugProtocol.Breakpoint> {


		if (!this.isValidFunctionName(bp.name)) {

			// Report an unverified breakpoint when there is an attempt to
			// set a function breakpoint on something that cannot be a Perl
			// function; we cannot pass illegal names like `12345` to the
			// debugger as it might misinterpret it as something other than
			// a function breakpoint request.

			return new Breakpoint(false);

		}

		const res = await this.adapter.request(`b ${bp.name}`);

		if (/Subroutine \S+ not found/.test(res.data[0])) {
			// Unverified (and ignored by the debugger), but see below.
		}

		this.sendEvent(new OutputEvent(
			`Adding function breakpoint on ${bp.name}\n`
		));

		// NOTE(bh): This is a simple attempt to get file and line
		// information about where the sub is defined, at least to
		// some extent, by going through `%DB::sub`, assuming it has
		// already been loaded and has not been defined in unusal
		// ways. Not sure if vscode actually uses the values though.

		const pathPos = await this.adapter.getExpressionValue(
			`$DB::sub{'${this.adapter.escapeForSingleQuotes(bp.name)}'}`
		);

		const [ bpWhole, bpFile, bpFirst, bpLast ] = pathPos
			? pathPos.match( /(.*):(\d+)-(\d+)$/ )
			: [undefined, undefined, undefined, undefined];

		return new Breakpoint(
			!!pathPos,
			parseInt(bpFirst),
			undefined,
			this.findOrCreateSource(bpFile)
		);

	}

	private async setFunctionBreakPointsRequestAsync(response: DebugProtocol.SetFunctionBreakpointsResponse, args: DebugProtocol.SetFunctionBreakpointsArguments): Promise<DebugProtocol.SetFunctionBreakpointsResponse> {

		// FIXME(bh): It is not clear yet how to set breakpoints on subs
		// that are not yet loaded at program start time. Global watch
		// expressions can be used like so:
		//
		//   % perl -d -e0
		//
		//   Loading DB routines from perl5db.pl version 1.53
		//   Editor support available.
		//
		//   Enter h or 'h h' for help, or 'man perldebug' for more help.
		//
		//   main::(-e:1):	0
		//   	DB<1> w *Data::Dumper::Dumper{CODE}
		//   	DB<2> use Data::Dumper
		//
		//   	DB<3> r
		//   Watchpoint 0:	*Data::Dumper::Dumper{CODE} changed:
		//   		old value:	''
		//   		new value:	'CODE(0x55f9e2629688)'
		//
		// But possibly with considerable performance impact as any
		// watch expression would put the debugger in trace mode? Might
		// make sense to offer that behind a `launch.json` option.

		for (const [name, bp] of this._functionBreakPoints.entries()) {

			// Remove breakpoint
			await this.adapter.request(`B ${name}`);

		}

		this._functionBreakPoints.clear();

		for (const bp of args.breakpoints) {

			this._functionBreakPoints.set(
				bp.name,
				await this.setFunctionBreakPointAsync(bp)
			);

		}

		response.body = {
			breakpoints: [...this._functionBreakPoints.values()]
		};

		return response;
	}

	protected setFunctionBreakPointsRequest(response: DebugProtocol.SetFunctionBreakpointsResponse, args: DebugProtocol.SetFunctionBreakpointsArguments): void {
		this.setFunctionBreakPointsRequestAsync(response, args)
			.then(res => {
				this.sendResponse(response);
			})
			.catch(err => {
				const [ error = err ] = err.errors || [];
				this.sendEvent(new OutputEvent(`ERR>setFunctionBreakPointsRequest error: ${error.message}\n`));
				response.success = false;
				this.sendResponse(response);
			});
	}

/**
 * Implemented
 */

	/**
	 * Set variable
	 */
    protected async setVariableRequest(response: DebugProtocol.SetVariableResponse, args: DebugProtocol.SetVariableArguments) {

			const expr = this._variableMap.expr(args.variablesReference);
			const escapedName = this.adapter.escapeForSingleQuotes(args.name);

			const evalThis = `Devel::vscode::_set_variable(\\${expr.length ? expr : args.name}, '${escapedName}', scalar(${args.value}))`;

			const answer = await this.adapter.getExpressionValue(
				evalThis
			);

			response.body = {
				value: answer,
			};

			response.success = true;
			this.sendResponse(response);
	}

	/**
	 * Step out
	 */
	protected stepOutRequest(response: DebugProtocol.StepOutResponse, args: DebugProtocol.StepOutArguments): void {
		this.adapter.request('r');
		this.sendResponse(response);
	}

	/**
	 * Step in
	 */
	protected stepInRequest(response: DebugProtocol.StepInResponse, args: DebugProtocol.StepInArguments): void {
		this.adapter.request('s');
		this.sendResponse(response);
	}

	/**
	 * Restart
	 */
	private async restartRequestAsync(response: DebugProtocol.RestartResponse, args: DebugProtocol.RestartArguments): Promise<DebugProtocol.RestartResponse> {
		const res = await this.adapter.request('R')
		if (res.finished) {
			this.sendEvent(new TerminatedEvent());
		} else {
			// FIXME: probably not correct to do this here.
			this.sendStoppedEvent("entry");
		}

		return response;
	}

	protected restartRequest(response: DebugProtocol.RestartResponse, args: DebugProtocol.RestartArguments): void {
		this.restartRequestAsync(response, args)
			.then(res => this.sendResponse(res))
			.catch(err => {
				response.success = false;
				this.sendResponse(response);
			});
	}

	/**
	 * Breakpoints
	 */
	private async setBreakPointsRequestAsync(response: DebugProtocol.SetBreakpointsResponse, args: DebugProtocol.SetBreakpointsArguments): Promise<DebugProtocol.SetBreakpointsResponse> {

		const path = args.source.path;

		const debugPath = await this.adapter.relativePath(path);
		const editorExisting = this._breakPoints.get(path);
		const editorBPs: number[] = args.lines.map(ln => ln);
		const dbp = await this.adapter.getBreakPoints();
		const debuggerPBs: number[] = (await this.adapter.getBreakPoints())[debugPath] || [];
		const createBP: number[] = [];
		const removeBP: number[] = [];
		const breakpoints = new Array<Breakpoint>();

		// Clean up debugger removing unset bps
		for (let i = 0; i < debuggerPBs.length; i++) {
		 	const ln = debuggerPBs[i];
			if (editorBPs.indexOf(ln) < 0) {
				await this.adapter.clearBreakPoint(ln, debugPath);
			}
		}

		// Add missing bps to the debugger
		for (let i = 0; i < editorBPs.length; i++) {
		 	const ln = editorBPs[i];
			if (debuggerPBs.indexOf(ln) < 0) {
				try {
					const res = await this.adapter.setBreakPoint(ln, debugPath);
					const bp = <DebugProtocol.Breakpoint> new Breakpoint(true, ln);
					bp.id = this._breakpointId++;
					breakpoints.push(bp);
				} catch(err) {
					const bp = <DebugProtocol.Breakpoint> new Breakpoint(false, ln);
					bp.id = this._breakpointId++;
					breakpoints.push(bp);
				}
			} else {
				// This is good
				const bp = <DebugProtocol.Breakpoint> new Breakpoint(true, ln);
				bp.id = this._breakpointId++;
				breakpoints.push(bp);
			}
		}

		this._breakPoints.set(path, breakpoints);

		// send back the actual breakpoint positions
		response.body = {
			breakpoints: breakpoints
		};

		return response;
	}

	protected setBreakPointsRequest(response: DebugProtocol.SetBreakpointsResponse, args: DebugProtocol.SetBreakpointsArguments): void {
		this.setBreakPointsRequestAsync(response, args)
			.then(res => this.sendResponse(res))
			.catch(err => {
				response.success = false;
				this.sendResponse(response)
			});
	}

	/**
	 * Next
	 */
	protected nextRequest(response: DebugProtocol.NextResponse, args: DebugProtocol.NextArguments): void {
		this.adapter.request('n');
		this.sendResponse(response);
	}

	/**
	 * Continue
	 */
	protected continueRequest(response: DebugProtocol.ContinueResponse, args: DebugProtocol.ContinueArguments): void {

		// NOTE(bh): The code for execution control requests like this
		// one used to delay sending a response and events until there
		// has been a response from the debugger. That does not make
		// sense though since we explicitly pass control the debugger,
		// and it might not return at all until the debuggee terminates.
		// Instead, responses are sent immediately and events are sent
		// based on the actual state of the debugger.

		this.adapter.request('c');
		this.sendResponse(response);
	}

	/**
	 * Scope request
	 */
	protected async scopesRequest(response: DebugProtocol.ScopesResponse, args: DebugProtocol.ScopesArguments) {

		const pkg = await this.adapter.getExpressionValue('$DB::package');

		const lexicalRef = this._variableMap.create(
			new PerlVariableRoot("lexical", args.frameId)
		);

		const packageRef = this._variableMap.create(
			new PerlVariableRoot("package", args.frameId, pkg)
		);

		// TODO(bh): The global scope could be split thematically like in
		// the `perldoc perlvar` documentation, e.g.
		//
		//   * Global: General
		//   * Global: Regex
		//   * Global: Filehandles
		//   * Global: Errors
		//   * Global: Interpreter
		//   * Global: Deprecated
		//
		// Or they could be split into common ones like `$_` and `%ENV`
		// and obscure ones like `$)` and `$^P`. An interesting grouping
		// would be "has same value as when interpreter started" vs not,
		// or an approximation of that.
		//
		// Relatedly, at the moment we do not show some global symbols,
		// and neither some package symbols, like those for subroutines.
		// They are hidden to avoid cluttering the user interface, but it
		// might be useful to show them in special `functions` scopes?

		const globalRef = this._variableMap.create(
			new PerlVariableRoot("global", args.frameId)
		);

		const lexicalScope = new Scope("Lexical", lexicalRef, false);
		const packageScope = new Scope(`Package ${pkg}`, packageRef, false);
		const globalScope = new Scope("Global", globalRef, true);

		if (pkg === 'main') {
			// The global scope is the same as the `main` package scope.
			response.body = {
				scopes: [
					lexicalScope,
					globalScope,
				]
			};

		} else {
			response.body = {
				scopes: [
					lexicalScope,
					packageScope,
					globalScope,
				]
			};

		}

		this.sendResponse(response);

	}

	/**
	 * Variable scope
	 */
	protected async variablesRequest(response: DebugProtocol.VariablesResponse, args: DebugProtocol.VariablesArguments) {

		const perlVar = this._variableMap.get(args.variablesReference);

		const convert = (x) => {

			const newRef = x[2] || x[3] ?
				this._variableMap.create(
					new PerlVariable(args.variablesReference, x[4])
				)
				: undefined;

			const newVar: DebugProtocol.Variable = new Variable(
				x[0],
				x[1],
				newRef,
				x[2],
				x[3]
			);

			newVar.evaluateName = this._variableMap.expr(newRef);

			return newVar;

		};

		if (perlVar instanceof PerlVariableRoot) {

			if (perlVar.scope === 'lexical') {

				const vars = await this.adapter.getLexicalVariables(
					perlVar.frameId
				);

				response.body = {
					variables: vars.map(convert)
				}

			}

			if (perlVar.scope === 'package') {

				const vars = await this.adapter.getPackageVariables(
					await this.adapter.getExpressionValue('$DB::package')
				);

				response.body = {
					variables: vars.map(convert)
				}

			}

			if (perlVar.scope === 'global') {

				const vars = await this.adapter.getPackageVariables(
					await this.adapter.getExpressionValue('main')
				);

				response.body = {
					variables: vars.map(convert)
				}

			}

		} else if (perlVar instanceof PerlVariable) {

			const expr = this._variableMap.expr(args.variablesReference);
			const vars = await this.adapter.getExprVariables(expr);

			response.body = {
				variables: vars.map(convert)
			};

		} else {

			response.success = false;

		}

		this.sendResponse(response);

	}

	/**
	 * Evaluate hover
	 */
	private async evaluateHover(response: DebugProtocol.EvaluateResponse, args: DebugProtocol.EvaluateArguments) {

		// FIXME: This evaluates method calls `$obj->method` which
		// is fairly likely to have destructive side-effects.

		if (/^[\$|\@]/.test(args.expression)) {
			const expression = args.expression.replace(/\.(\'\w+\'|\w+)/g, (...a) => `->{${a[1]}}`);

			const result = await this.adapter.getExpressionValue(expression);
			if (/^HASH/.test(result)) {
				response.body = {
					result: result,
					variablesReference: 0,
					type: 'string'
				};
			} else {
				response.body = {
					result: result,
					variablesReference: 0
				};
			}
			this.sendResponse(response);

		} else {
			response.success = false;
			this.sendResponse(response);
		}
	}


	/**
	 * Evaluate command line
	 */
	private async evaluateCommandLine(response: DebugProtocol.EvaluateResponse, args: DebugProtocol.EvaluateArguments) {
		const res = await this.adapter.request(args.expression);

		if (res.data.length > 1) {
			res.data.forEach((line) => {
				this.sendEvent(new OutputEvent(`> ${line}\n`));
			});
			response.body = {
				result: `Result:`,
				variablesReference: 0,
			};
		} else {
			response.body = {
				result: `${res.data[0]}`,
				variablesReference: 0
			};
		}

		// FIXME(bh): It might make sense to send another stopped event
		// here which would trigger an update of the variables view,
		// which would be useful if variables have been modified through
		// the REPL interface.
		// this.sendStoppedEvent("postrepl");

		this.sendResponse(response);
	};

	/**
	 * Evaluate
	 */
	protected async evaluateRequest(response: DebugProtocol.EvaluateResponse, args: DebugProtocol.EvaluateArguments) {

		if (args.context === 'repl') {

			// The `repl` is a special case since it can be used to send
			// commands to the debugger instead of just evaluating actual
			// Perl expressions.
			this.evaluateCommandLine(response, args);

		} else if (args.context === 'hover') {

			// And `hover` is a special case because we need to filter out
			// bogus or dangerous evaluation requests that cannot or should
			// not be satisfied (syntax errors, evaluations with possible
			// side effects, and similar issues).
			this.evaluateHover(response, args);

		} else {

			this.sendEvent(new OutputEvent(
				`evaluate(context: '${args.context}', '${args.expression}')`
			));

			const result = await this.adapter.getExpressionValue(
				args.expression
			);

			response.body = {
				result: result,
				variablesReference: 0
			};

			this.sendResponse(response);
		}

	}

	/**
	 * Stacktrace
	 */
	private async stackTraceRequestAsync(response: DebugProtocol.StackTraceResponse, args: DebugProtocol.StackTraceArguments): Promise<DebugProtocol.StackTraceResponse> {

		// TODO(bh): Maybe re-set the function breakpoints from here, if
		// there are any newly loaded sources there most probably are new
		// functions, and we might be trying to break on one of them...

		const stacktrace = await this.adapter.getStackTrace();

		const frames = stacktrace.map((trace, i) => {

			return new StackFrame(
				i,
				`${trace.caller}`,
				/^\(eval \d+\)/.test(trace.caller)
					? null
					: this.findOrCreateSource(
							trace.filename
						),
				trace.line,
				0
			);

		});

		// In case this is a trace run on end, we want to return the
		// file with the exception in the @ position

		// FIXME(bh): This does not really make sense, for a number of
		// reasons. One is that this re-uses a `StackFrame.id`.

		let endFrame = frames[frames.length - 1];
		if (endFrame && endFrame.name === 'DB::END') {
			frames.unshift(endFrame);
		}

		response.body = {
			stackFrames: frames,
			totalFrames: frames.length
		};

		return response;
	}

	protected stackTraceRequest(response: DebugProtocol.StackTraceResponse, args: DebugProtocol.StackTraceArguments): void {
		this.stackTraceRequestAsync(response, args)
			.then(res => this.sendResponse(res))
			.catch(err => {
				const [ error = err ] = err.errors || [];
				this.sendEvent(new OutputEvent(`--->Trace error...${error.message}\n`));
				response.success = false;
				response.body = {
					stackFrames: [],
					totalFrames: 0
				};
				this.sendResponse(response);
			});
	}

	private findOrCreateSource(path: string): Source {

		const oldSource = this._loadedSources.get(path);

		if (oldSource) {
			return oldSource;
		}

		const newSource = new Source(
			basename(path),
			path,
			// no sourceReference when debugging locally, so vscode will
			// open the local file rather than retrieving a read-only
			// version of the code through the debugger (that lacks code
			// past `__END__` markers, among possibly other limitations).
			this.adapter.canSignalDebugger
				? 1 + this._loadedSources.size // FIXME: XXX
				: 1 + this._loadedSources.size
		);

		this._loadedSources.set(path, newSource);

		this.sendEvent(new LoadedSourceEvent("new", newSource));

		return newSource;

	}

	private async loadedSourcesRequestAsync(response: DebugProtocol.LoadedSourcesResponse, args: DebugProtocol.LoadedSourcesArguments): Promise<DebugProtocol.LoadedSourcesResponse> {

		const loadedFiles = await this.adapter.getLoadedFiles();

		loadedFiles.forEach(x => this.findOrCreateSource(x));

		response.body = {
			sources: [...this._loadedSources.values()]
		};

		return response;

	}

	protected loadedSourcesRequest(response: DebugProtocol.LoadedSourcesResponse, args: DebugProtocol.LoadedSourcesArguments) {

		this.loadedSourcesRequestAsync(response, args)
			.then(res => this.sendResponse(res))
			.catch(err => {

				const [ error = err ] = err.errors || [];
				this.sendEvent(new OutputEvent(`--->Loaded sources request error...${error.message}\n`));
				response.success = false;
				response.body = {
					sources: [
					]
				};
				this.sendResponse(response);
			});

	}

	private async sourceRequestAsync(response: DebugProtocol.SourceResponse, args: DebugProtocol.SourceArguments): Promise<DebugProtocol.SourceResponse> {

		// NOTE(bh): When sources reported by `loadedSources` have some
		// non-zero `sourceReference` specified, Visual Studio Code will
		// ask us for the source code, otherwise it interprets the `path`
		// as a local file. Our `loadedSources` takes the paths from the
		// Perl debugger, and `sourceReference` is just a counter value.
		// Accordingly there is no point for us to distinguish the cases.

		if (args.source && args.source.sourceReference) {
			// retrieve by source reference
		} else {
			// retrieve by path
		}

		response.body = {
			content: await this.adapter.getSourceCode(
				args.source.path
			)
		};

		return response;
	}

	protected sourceRequest(response: DebugProtocol.SourceResponse, args: DebugProtocol.SourceArguments) {

		this.sourceRequestAsync(response, args)
			.then(res => this.sendResponse(res))
			.catch(err => {

				const [ error = err ] = err.errors || [];
				this.sendEvent(new OutputEvent(`--->Source request error...${error.message}\n`));
				response.success = false;
				response.body = {
					content: `# error`,
					mimeType: `text/vnd.vscode-perl-debug.error`,
				};
				this.sendResponse(response);

			});

	}

	// Custom requests

	protected customRequestx(command: string, response: DebugProtocol.Response, args: any) {
		if (command === '...') {
			// this....(response, args);
		}
		response.success = false;
	}

}

