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
import { variableType, ParsedVariable, ParsedVariableScope, resolveVariable } from './variableParser';

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
	/** How to handle forked children or multiple connections */
	sessions?: string,
}

export class PerlDebugSession extends LoggingDebugSession {
	private static THREAD_ID = 1;

	private _breakpointId = 1000;

	private _breakPoints = new Map<string, DebugProtocol.Breakpoint[]>();

	private _functionBreakPoints: Map<string, DebugProtocol.Breakpoint>
		= new Map<string, DebugProtocol.Breakpoint>();

	private _loadedSources = new Map<string, Source>();

	private _variableHandles = new Handles<string>();

	public dcSupportsRunInTerminal: boolean = false;

	private adapter: PerlDebuggerConnection;

	public constructor() {
		super('perl_debugger.log');

		this.adapter = new PerlDebuggerConnection();

		this.setDebuggerLinesStartAt1(false);
		this.setDebuggerColumnsStartAt1(false);
	}

	private rootPath: string = '';

	private _configurationDone = new Subject();

   /* protected convertClientPathToDebugger(clientPath: string): string {
		return clientPath.replace(this.rootPath, '');
	}

    protected convertDebuggerPathToClient(debuggerPath: string): string {
		return join(this.rootPath, debuggerPath);
	}*/

	protected initializeRequest(response: DebugProtocol.InitializeResponse, args: DebugProtocol.InitializeRequestArguments): void {

		this.dcSupportsRunInTerminal = !!args.supportsRunInTerminalRequest;

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
			this.sendEvent(new StoppedEvent("breakpoint", PerlDebugSession.THREAD_ID));
		});

		this.adapter.on('perl-debug.close', (x) => {
			this.sendEvent(new TerminatedEvent());
		});

		this.adapter.on('perl-debug.debug', (...x) => {
			// FIXME: needs to check launch options
			this.sendEvent(new Event('perl-debug.debug', x));
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

				// make VS Code to show a 'step back' button
				response.body.supportsStepBack = false;

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
			this.sendEvent(
				new ContinuedEvent(PerlDebugSession.THREAD_ID)
			);

		} else if (sessions === 'break') {

			this.sendEvent(
				new StoppedEvent("postfork", PerlDebugSession.THREAD_ID)
			);

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
			this.sendEvent(new StoppedEvent("entry", PerlDebugSession.THREAD_ID));
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

		response.success = false;
		this.sendResponse(response);
		this.sendEvent(new StoppedEvent("entry", PerlDebugSession.THREAD_ID));
 	}

	/**
	 * Step back
	 */
	protected stepBackRequest(response: DebugProtocol.StepBackResponse, args: DebugProtocol.StepBackArguments): void {
		this.sendEvent(new OutputEvent(`ERR>Step back not implemented\n`));

		response.success = false;
		this.sendResponse(response);
		this.sendEvent(new StoppedEvent("entry", PerlDebugSession.THREAD_ID));
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
			new Source(
				bpFile,
				bpFile,
			)
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
    protected setVariableRequest(response: DebugProtocol.SetVariableResponse, args: DebugProtocol.SetVariableArguments): void {
		// Get type of variable contents
		const name = this.getVariableName(args.name, args.variablesReference)
			.then((variableName) => {

				// We use perl's eval() here for maximum flexibility so that the user can actually change the type of the value in the VS Code
				// GUI on-the-fly. E.g. by simply changing a scalar value into an array ref by typing [1,2,3] as the new value of the scalar.
				// E.g. if the user has an array @a = (1,2,3) and edits the 2nd element (2) by typing [4,5,6] in the GUI, the scalar value of 2
				// will be replaced with the expected array ref, so the updated array will look like @a = (1,[4,5,6],3) after the edit.
				// This allows the user to arbitrarily change the structure of composite types (like arrays and hashes) on-the-fly during debugging
				// using the VS Code GUI. In fact, it also allows you to do arithmetic during editing a value so you can just simply type "11 + 22"
				// as the new value and it becomes 33. And you can use any valid perl expression for the new value e.g. $x + $y will set the value
				// to the sum of vars $x and $y (they obviously have to be defined in the perl code and visible in the given scope).
				//
				// Note that we also support perl string interpolation just like perl does.
				// This means that what the new value will be depends on whether or how the specified value is quoted by the user in the GUI.
				//
				// Assume we have two perl vars $x and $y, with values 1 and 2 respectively, then quoting will work as a perl programmer expects it
				// to work:
				//
				//   1. Unquoted expression: $x + $y evaluates to the value 3 because $x = 1 and $y = 2. (3 = 1 + 2)
				//
				//   2. Quoted expression:
				//
				//      1. Single-quoted: '$x + $y' evaluates to the string '$x + $y'. No variable interpolation
				//
				//      2. double-quoted: "$x + $y" evaluates to the string '1 + 2'. Variable interpolation
				//
				//
				//  Note that the following assignment operations assume that the user types in meaningful perl expressions.
				//
				//  Otherwise GIGO rules apply. That is, if the user specifies a garbage expression, then the result will be a garbage value or a failed assignment.
				//  If the user-specified string is not a valid perl expression then it will be assigned as an interpolated perl string (unless it's single quoted,
				//  in which case it's not interpolated). This is not a bug but a feature (and hence it won't be "fixed"). The malformed expression will be assigned
				//  as a string to the variable so that the user can easily see that they made a mistake (because they will get a string instead of e.g. the expected
				//  array). But for normal everyday well-formed user input this will not happen so it will not be an issue.
				//
				//  That is, the following implementation provides perl programmers with an intuitive set of assignment operations but it assumes that the
				//  user actually knows what perl expressions actually look like (so that they don't type garbage expressions in).
				//
				//  Note that some of the heuristic assignment rules below deliberately use extended semantics compared to perl to make value assignments uniform
				//  for both composite (arrays, hashes, objects) and scalar variables so that you don't have to care about whether you have to specify an array or
				//  an array ref when e.g. creating an array. This is not a bug but a feature. So that you can just simply use the same array (1,2,3,4) and assign
				//  this in the VS Code GUI to any type of variable and you will get an array in the appropriate form (array or array ref). In other words, these
				//  assignment rules automatically convert between arrays and array refs as needed depending on context, hence allowing intuitive uniform assingments
				//  to variables. E.g. in the VS Code GUI you can assign the array (1,2,3,4) to an array @a, an element in the array $a[i], to a hash %h, to a key
				//  in the hash $h{k} or a scalar $s and you will get an array in the given position
				//
				//    @a    = (1,2,3,4)
				//    $a[i] = [1,2,3,4]
				//    %h    = (1,2,3,4)
				//    $h{k} = [1,2,3,4]
				//    $s    = [1,2,3,4]
				//
				//  Note that some of these arrays are actually array refs but you don't have to care about this difference. The appropriate form (ref or non-ref)
				//  will be used automatically.
				//
				//  So you can just simply assign an array value of (1,2,3,4) to any variable without having to care about whether you have to use an array ref or
				//  not in the given context. But this also means that these intuitive assignments are NOT (necessarily) perl assignment instructions. Because perl
				//  doesn't do this automatic conversion between refs and nonrefs. So in perl the above assignments would be
				//
				//    @a    = (1,2,3,4)
				//    $a[i] = (1,2,3,4)
				//    %h    = (1,2,3,4)
				//    $h{k} = (1,2,3,4)
				//    $s    = (1,2,3,4)
				//
				//  and although the assignments to @a and %h would work the same way as above, but perl would assign the last element (4) to all the scalar variables
				//  $a[i], $h{k} and $s (so $a[i] = 4, $h{k} = 4, $s = 4) because of the scalar context, which is obviously not what the user's intention was when they
				//  specified (1,2,3,4) in the GUI.
				//
				//  So the intuitive heuristic assignment rules below do what the user would intuitively expect to happen and not necessarily what perl would do:)
				//
				//
				//  The following array (@a), hash (%h) and scalar ($s) assigment operations are supported:
				//  ---------------------------------------------------------------------------------------
				//
				//    The "User Input" column shows what the user types into the VS Code GUI edit box when editing a variable (@a, %h, $s).
				//    The "Assignment" column shows what perl assignment will be done as a result.
				//
				//    E.g. typing @x into the edit box while editing the value of @a will copy the elements of @x over into @a as in @a = @x.
				//
				//
				//        User Input    Assignment
				//
				//     @a:
				//            @x        @a = @x
				//            %h        @a = %h
				//            $s        @a = ($s)
				//           {1,2}      @a = (1,2)
				//          ({1,2})     @a = ({1,2})
				//           1,2,3      @a = (1,2,3)
				//          (1,2,3)     @a = (1,2,3)
				//          [1,2,3]     @a = (1,2,3)
				//         ([1,2,3])    @a = ([1,2,3])
				//
				//     %h:
				//             %x       %h = %x
				//             @a       %h = @a
				//           {1,2}      %h = (1,2)
				//          1,2,3,4     %h = (1,2,3,4)  (hence (1 => 2, 3 => 4))
				//         (1,2,3,4)    %h = (1,2,3,4)
				//         [1,2,3,4]    %h = (1,2,3,4)
				//
				//     $s:
				//             $x       $s = $x
				//             @a       $s = [@a]
				//             %h       $s = {@{[%h]}}  (a hashref to a copy of %h)
				//           {1,2}      $s = {1,2}
				//           1,2,3      $s = "1,2,3"
				//          (1,2,3)     $s = [1,2,3]
				//          [1,2,3]     $s = [1,2,3]
				//         ([1,2,3])    $s = [[1,2,3]]
				//           undef      $s = undef
				//
				//    String ops with the usual quoting rules and variable interpolation are also supported.
				//
				//    Plus some simpler perl expressions. Invalid expressions are treated as double-quoted strings and will be interpolated accordingly.
				//    Some examples: assuming $x = 1 and $y = 2
        //
				//          11 + 22     $s = 11 + 22     (hence $s = 33)
				//          $x + $y     $s = 1  + 2      (hence $s = 3)
				//         '$x + $y'    $s = '$x + $y'
				//         "$x + $y"    $s = "1 + 2"
				//
				//          $x,$y,3     $s = "1,2,3"
				//         ($x,$y,3)    $s = [1,2,3]
				//         [$x,$y,3]    $s = [1,2,3]
				//
				//      Invalid expressions are treated as double-quoted strings and interpolated accordingly e.g.
				//
				//          11 +        $s = "11 +"
				//          $x +        $s = "1 +"
				//
				//      Quoted invalid expressions are strings and hence are interpolated according to their quotation marks e.g.
				//
				//         '$x +'       $s = '$x +'
				//         "$x +"       $s = "1 +"
				//
				//      Special case for x'y. Old-style class reference lookalikes are interpreted as strings and not as x::y because it's extremely unlikely
				//      that actually old-style class references are used by the user in the expression. This way strings with single-quotes will work
				//      seamlessly (e.g. "There's" remains "There's" intead of becoming "There::s":)
				//
				//           x'y        $s = "x'y"
				//
				//  The above assignment ops provide perl programmers with an intuitive set of assignment operations for everyday use cases.

				// Note that initially the user-specified value will appear in the GUI as specified by the user, that is, as the original string because
				// VS Code doesn't update the GUI immediately. But once the user does a single-step in the debugger the evaluated expression value
				// will be displayed in the GUI as the GUI updates.

				let value = args.value.replace(/^\s*/,'').replace(/\s*$/,''); // remove leading and trailing whitespace if any

				if (!/^'.*'$/.test(value) && value != 'undef' && !/^"\s+"$/.test(value)) { // Single-quoted strings, undef, double-quoted whitespace strings
					if (value == '' || value == "''" || value == '""') { value = "''"; }     // and empty strings are passed through directly
						else if (/^[ '"]+$/.test(value)) {
							// Quote trolling empty strings and pass them through:)
							// There is no real-life need to specify a value string like this one so the user is obviously trying to troll this parser.:)
							// Or they might just have a very "special" pathological use case.:)

							// This string might be a malformed quotation mark fest so we replace the outermost quotation mark pair (if any)
							if (/^'.*'$/.test(value)) { value = value.replace(/^'(.*)'$/,'$1'); }
							  else if (/^".*"$/.test(value)) { value = value.replace(/^"(.*)"$/,'$1'); }

						  // And then we quote the string properly so that it's a properly delimited string and hence it can be assigned to a variable
							value = "'" + value.replace(/'/g,"\\'") + "'";
						}
						else if (/^\S*\w'\w\S*$/.test(value)) { value = '"' + value + '"'; } // Pass old-style class ref single words of the form a'b'c through
							else {                                                             // because eval() converts them to a::b::c, which we don't want
								// This is a non-empty value string that's not 'undef'
								let use_eval         = true;
								let eval_type_prefix = ''; // not needed for scalar types. Only needed for arrays and hashes
								let eval_type_suffix = '';

								if (/^@/.test(variableName) || /^%/.test(variableName)) {
									if (/^@/.test(value) || /^%/.test(value)) { use_eval = false; } // because it can be directly assigned e.g. @a = @x, %h = %x
										else {

											if (/^\{.*\}$/.test(value)) { value = value.replace(/^./,'[').replace(/.$/,']'); } // {expr} -> [expr]
												else if (!/^\[.*\]$/.test(value) && !/^\(.*\)$/.test(value)) { // if not array (expr) or [expr]
													value = '[' + value + ']'; // value -> [value]
												}

											eval_type_prefix = '@'; // we use arrays internally during evaluation. Even for hashes
										}
								}

								if (use_eval) {

									if (/^\(.*\)$/.test(value) || /^\{.*\}$/.test(value)) { // value = {expr} or value = (expr)

										if (/^\{/.test(value)) {
											eval_type_prefix = '{@'; // to generate a hash ref from the array (ref) after evaluation
											eval_type_suffix = '}';
										}

										value = value.replace(/^./,'[').replace(/.$/,']'); // (expr)|{expr} -> [expr]
									}
									else if (/^@/.test(value)) { value = '[' + value + ']'; }  // @a -> [@a]
									else if (/^%/.test(value)) {
										value = '[' + value + ']'; // %h -> [%h]
										eval_type_prefix = '{@';   // to generate a hash ref from the array (ref) after evaluation
										eval_type_suffix = '}';
									}
									else if (!/^\[.*\]$/.test(value) && !/^{.*}$/.test(value) && /,/.test(value)) {
										// This might be a list e.g. 1, 2, 3. If it is then we treat it as a simple string and double-quote it
										let v = value.replace(/(".*?),(.*?")/g,'$1 $2').replace(/('.*?),(.*?')/g,'$1 $2'); // mask commas inside strings

										// Double-quote it if it looks like a list
										if (/,/.test(v)) { value = '"' + value.replace(/"/g,'\\"') + '"'; } // 1, 2, 3 -> "1, 2, 3"
									}

									// Escape the single-quotes in the value (if any) TWICE for the nested single-quoting in the eval() below
									value = value.replace(/'/g,"\\\\\\'"); // ' -> \\\'

									// If it's a valid perl expression then we use the value of the expression otherwise we use the value directly as a string.
									// This way users can just simply type strings in without having to quote the string in the GUI. So they can just type
									// expressions or strings in and it will just work in both cases
									value = "eval('no warnings; " +

																"my $v = \\'" + value + "\\'; " +    // single-quoting to prevent string interpolation at this point

																"my $r; eval { $r = eval($v) }; " +  // check if it's a valid expression and get its value if it is

																"if (not defined $r) { " +           // and if it's not then treat it as a double-quoted string and interpolate
																	"my $qv = $v !~ /^\".*\"$/ ? \\'\"\\'.$v.\\'\"\\' : $v; " +
																	"eval { $r = eval(\"$qv\"); }; " +
																"} " +

																"defined($r) ? $r : $v')";  // if all else fails then we just return the original value string as the result

									if (eval_type_prefix) { // The eval type prefix and suffix are used for type conversion to convert the array ref eval result
										value = eval_type_prefix + '{' + value + '}' + eval_type_suffix; // to the target type
									}
								}
							}
				}

				return this.adapter.request(`${variableName}=${value}`)
					.then(() => {
						response.body = {
							value: args.value,
							type: variableType(args.value),
						};
						this.sendResponse(response);
					});
			})
			.catch((err) => {
				const [ error = err ] = err.errors || [];
				this.sendEvent(new OutputEvent(`ERR>setVariableRequest error: ${error.message}\n`));
				response.success = false;
				this.sendResponse(response);
			});
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
			this.sendEvent(new StoppedEvent("entry", PerlDebugSession.THREAD_ID));
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
	protected scopesRequest(response: DebugProtocol.ScopesResponse, args: DebugProtocol.ScopesArguments): void {
		const frameReference = args.frameId;
		const scopes = new Array<Scope>();
		scopes.push(new Scope("Local", this._variableHandles.create("local_" + frameReference), false));
		scopes.push(new Scope("Closure", this._variableHandles.create("closure_" + frameReference), false));
		scopes.push(new Scope("Global", this._variableHandles.create("global_" + frameReference), true));

		response.body = {
			scopes: scopes
		};
		this.sendResponse(response);
	}

	private getVariableName(name: string, variablesReference: number): Promise<string> {
		let id = this._variableHandles.get(variablesReference);
		return this.adapter.variableList({
			global_0: 0,
			local_0: 1,
			closure_0: 2,
		})
		.then(variables => {
			return resolveVariable(name, id, variables);
		});
	}

	/**
	 * Variable scope
	 */
	protected variablesRequest(response: DebugProtocol.VariablesResponse, args: DebugProtocol.VariablesArguments): void {
		const id = this._variableHandles.get(args.variablesReference);

		this.adapter.variableList({
			global_0: 0,
			local_0: 1,
			closure_0: 2,
		})
			.then(variables => {
				const result = [];

				if (id != null && variables[id]) {
					const len = variables[id].length;
					const result = variables[id].map(variable => {
						// Convert the parsed variablesReference into Variable complient references
						if (variable.variablesReference === '0') {
							variable.variablesReference = 0;
						} else {
							variable.variablesReference = this._variableHandles.create(`${variable.variablesReference}`);
						}
						return variable;
					});

					response.body = {
						variables: <Variable[]>result
					};
					this.sendResponse(response);
				} else {
					this.sendResponse(response);
				}
			})
			.catch(() => {
				response.success = false;
				this.sendResponse(response);
			});
	}

	/**
	 * Evaluate hover
	 */
	private evaluateHover(response: DebugProtocol.EvaluateResponse, args: DebugProtocol.EvaluateArguments) {
		if (/^[\$|\@]/.test(args.expression)) {
			const expression = args.expression.replace(/\.(\'\w+\'|\w+)/g, (...a) => `->{${a[1]}}`);

			this.adapter.getExpressionValue(expression)
				.then(result => {
					if (/^HASH/.test(result)) {
						response.body = {
							result: result,
							variablesReference: this._variableHandles.create(result),
							type: 'string'
						};
					} else {
						response.body = {
							result: result,
							variablesReference: 0
						};
					}
					this.sendResponse(response);
				})
				.catch(() => {
					response.body = {
						result: undefined,
						variablesReference: 0
					};
					this.sendResponse(response);
				});
		} else {
			this.sendResponse(response);
		}
	}


	/**
	 * Evaluate command line
	 */
	private evaluateCommandLine(response: DebugProtocol.EvaluateResponse, args: DebugProtocol.EvaluateArguments) {
		this.adapter.request(args.expression)
			.then((res) => {
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
				this.sendResponse(response);
			});
	};

	/**
	 * Fetch expression value
	 */
	async fetchExpressionRequest(clientExpression): Promise<any> {

		const isVariable = /^([\$|@|%])([a-zA-Z0-9_\'\.]+)$/.test(clientExpression);

		const expression = isVariable ? clientExpression.replace(/\.(\'\w+\'|\w+)/g, (...a) => `->{${a[1]}}`) : clientExpression;

		let value = await this.adapter.getExpressionValue(expression);
		if (/^Can\'t use an undefined value as a HASH reference/.test(value)) {
			value = undefined;
		}

		const reference = isVariable ? await this.adapter.getVariableReference(expression) : null;
		if (typeof value !== 'undefined' && /^HASH|ARRAY/.test(reference)) {
			return {
				value: reference,
				reference: reference,
			};
		}
		return {
			value: value,
			reference: null,
		};
	}

	/**
	 * Evaluate watch
	 * Note: We don't actually levarage the debugger watch capabilities yet
	 */
	protected evaluateWatch(response: DebugProtocol.EvaluateResponse, args: DebugProtocol.EvaluateArguments): void {
		// Clear watch if last request wasn't setting a watch?
		this.fetchExpressionRequest(args.expression)
			.then(result => {
				// this.sendEvent(new OutputEvent(`${args.expression}=${result.value} ${typeof result.value} ${result.reference}$')\n`));
				if (typeof result.value !== 'undefined') {
					response.body = {
						result: result.value,
						variablesReference: result.reference === null ? 0 : this._variableHandles.create(result.reference),
					};
				}
				this.sendResponse(response);
			})
			.catch(() => {});
	}

	/**
	 * Evaluate
	 */
	protected evaluateRequest(response: DebugProtocol.EvaluateResponse, args: DebugProtocol.EvaluateArguments): void {

		if (args.context === 'repl') {
			this.evaluateCommandLine(response, args);
		} else if (args.context === 'hover') {
			this.evaluateHover(response, args);
		} else if (args.context === 'watch') {
			this.evaluateWatch(response, args);
		} else {
			this.sendEvent(new OutputEvent(`evaluate(context: '${args.context}', '${args.expression}')`));
			response.body = {
				result: `evaluate(context: '${args.context}', '${args.expression}')`,
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
		const frames = new Array<StackFrame>();

		// In case this is a trace run on end, we want to return the file with the exception in the @ position
		let endFrame = null;

		stacktrace.forEach((trace, i) => {
			const frame = new StackFrame(i, `${trace.caller}`, new Source(basename(trace.filename),
				this.convertDebuggerPathToClient(trace.filename)),
				trace.ln, 0);
			frames.push(frame);
			if (trace.caller === 'DB::END()') {
				endFrame = frame;
			}
		});

		if (endFrame) {
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

	private async loadedSourcesRequestAsync(response: DebugProtocol.LoadedSourcesResponse, args: DebugProtocol.LoadedSourcesArguments): Promise<DebugProtocol.LoadedSourcesResponse> {

		const loadedFiles = await this.adapter.getLoadedFiles();

		const newFiles = loadedFiles.filter(
			x => !this._loadedSources.has(x)
		);

		for (const file of newFiles) {

			const newSource = new Source(
				file,
				file,
				// no sourceReference when debugging locally, so vscode will
				// open the local file rather than retrieving a read-only
				// version of the code through the debugger (that lacks code
				// past `__END__` markers, among possibly other limitations).
				this.adapter.canSignalDebugger
					? 0
					: this._loadedSources.size
			);

			this.sendEvent(new LoadedSourceEvent("new", newSource));

			this._loadedSources.set(file, newSource);

		}

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

