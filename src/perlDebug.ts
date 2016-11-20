/// <reference types="node" />

import {
	DebugSession,
	InitializedEvent, TerminatedEvent, StoppedEvent, BreakpointEvent, OutputEvent, Event,
	Thread, StackFrame, Scope, Source, Handles, Breakpoint
} from 'vscode-debugadapter';
import {DebugProtocol} from 'vscode-debugprotocol';
import {readFileSync} from 'fs';
import {basename, dirname} from 'path';
import {spawn, ChildProcess} from 'child_process';
import { perlDebuggerConnection } from './adapter';

/**
 * This interface should always match the schema found in the perl-debug extension manifest.
 */
export interface LaunchRequestArguments extends DebugProtocol.LaunchRequestArguments {
	/** An absolute path to the program to debug. */
	program: string;
	/** Automatically stop target after launch. If not specified, target does not stop. */
	stopOnEntry?: boolean;
}

class PerlDebugSession extends DebugSession {
	private static THREAD_ID = 1;

	private _breakpointId = 1000;

	// This is the next line that will be 'executed'
	private __currentLine = 0;
	private get _currentLine() : number {
		return this.__currentLine;
    }
	private set _currentLine(line: number) {
		this.__currentLine = line;
	}

	private _sourceFile: string;
	private filename: string;
	private filepath: string;

	private _sourceLines = new Array<string>();

	private _breakPoints = new Map<string, DebugProtocol.Breakpoint[]>();

	private _variableHandles = new Handles<string>();

	private perlDebugger = new perlDebuggerConnection();

	public constructor() {
		super();

		this.setDebuggerLinesStartAt1(false);
		this.setDebuggerColumnsStartAt1(false);
	}

	protected initializeRequest(response: DebugProtocol.InitializeResponse, args: DebugProtocol.InitializeRequestArguments): void {
		// Rig output
		this.perlDebugger.onOutput = (text) => {
			this.sendEvent(new OutputEvent(`${text}\n`));
		};

		this.perlDebugger.onException = (res) => {
			// xxx: for now I need more info, code to go away...
			this.sendEvent(new OutputEvent(`Exception...:${res.data.length}\n`, 'stderr'));

			res.data.forEach((val, i) => {
				this.sendEvent(new OutputEvent(`Exception...:${i}:${val}\n`, 'stderr'));
			});
			const parsed = res.data.join('\n').match(/line ([0-9]+)\.\n?$/);
			const ln = parsed ? parsed[1] : 0;
			this._currentLine = +ln - 1;
			this.sendEvent(new StoppedEvent("exception", PerlDebugSession.THREAD_ID));
			// this.sendEvent(new OutputEvent(`"${res.data.join(', ')}"\n`, 'stderr'));
			this.sendEvent(new OutputEvent(`Exception...2\n`, 'stderr'));

			this.sendEvent(new OutputEvent(`${JSON.stringify(parsed)}\n`, 'stderr'));
			this.sendEvent(new OutputEvent(`exception in line: ${ln}\n`, 'stderr'));
		};

		this.perlDebugger.initializeRequest()
			.then(() => {
				// since this debug adapter can accept configuration requests like 'setBreakpoint' at any time,
				// we request them early by sending an 'initializeRequest' to the frontend.
				// The frontend will end the configuration sequence by calling 'configurationDone' request.
				this.sendEvent(new InitializedEvent());

				// This debug adapter implements the configurationDoneRequest.
				response.body.supportsConfigurationDoneRequest = true;

				// make VS Code to use 'evaluate' when hovering over source
				response.body.supportsEvaluateForHovers = true;

				// make VS Code to show a 'step back' button
				response.body.supportsStepBack = true;

				this.sendResponse(response);
			});
	}

	protected launchRequest(response: DebugProtocol.LaunchResponse, args: LaunchRequestArguments): void {
		this._sourceFile = args.program;
		this._sourceLines = readFileSync(this._sourceFile).toString().split('\n');

		this.filename = basename(this._sourceFile);
		this.filepath = dirname(this._sourceFile);

		this.perlDebugger.launchRequest(this.filename, this.filepath)
			.then((res) => {
				if (args.stopOnEntry) {
					if (res.ln) {
						this._currentLine = res.ln - 1;
					}
					this.sendResponse(response);

					// we stop on the first line
					this.sendEvent(new StoppedEvent("entry", PerlDebugSession.THREAD_ID));
				} else {
					// we just start to run until we hit a breakpoint or an exception
					this.continueRequest(<DebugProtocol.ContinueResponse>response, { threadId: PerlDebugSession.THREAD_ID });
				}
			});

	}

	protected threadsRequest(response: DebugProtocol.ThreadsResponse): void {
		// xxx: Not sure if this is sufficient to levarage multi cores?
		// return the default thread
		response.body = {
			threads: [
				new Thread(PerlDebugSession.THREAD_ID, "thread 1")
			]
		};
		this.sendResponse(response);
	}


/**
 * TODO
 *
 * if possible:
 *
 * * step into
 * * step out
 * * restart could be softer
 * * step back
 * * reverse continue
 */


	/**
	 * Reverse continue
	 */
	protected reverseContinueRequest(response: DebugProtocol.ReverseContinueResponse, args: DebugProtocol.ReverseContinueArguments) : void {
		this.sendEvent(new OutputEvent(`ERR>Reverse continue not implemented\n\n`));

		this.sendResponse(response);
		// no more lines: stop at first line
		this._currentLine = 0;
		this.sendEvent(new StoppedEvent("entry", PerlDebugSession.THREAD_ID));
 	}

	/**
	 * Step back
	 */
	protected stepBackRequest(response: DebugProtocol.StepBackResponse, args: DebugProtocol.StepBackArguments): void {
		this.sendEvent(new OutputEvent(`ERR>Step back not implemented\n`));

		this.sendResponse(response);
		// no more lines: stop at first line
		this._currentLine = 0;
		this.sendEvent(new StoppedEvent("entry", PerlDebugSession.THREAD_ID));
	}
























/**
 * Implemented
 */
	/**
	 * Restart
	 */
	private async restartRequestAsync(response: DebugProtocol.RestartResponse, args: DebugProtocol.RestartArguments): Promise<DebugProtocol.RestartResponse> {
		const res = await this.perlDebugger.request('R')
		if (res.ln) {
			this._currentLine = this.convertDebuggerLineToClient(res.ln);
		}
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
			.catch(err => this.sendResponse(response));
	}

	/**
	 * Breakpoints
	 */
	private async setBreakPointsRequestAsync(response: DebugProtocol.SetBreakpointsResponse, args: DebugProtocol.SetBreakpointsArguments): Promise<DebugProtocol.SetBreakpointsResponse> {

		var path = args.source.path;
		var clientLines = args.lines;

		const debugPath = await this.perlDebugger.relativePath(path);
		const editorExisting = this._breakPoints.get(path);
		const editorBPs: number[] = args.lines.map(ln => ln);
		const dbp = await this.perlDebugger.getBreakPoints();
		const debuggerPBs: number[] = (await this.perlDebugger.getBreakPoints())[debugPath] || [];
		const createBP: number[] = [];
		const removeBP: number[] = [];
		var breakpoints = new Array<Breakpoint>();

		// Clean up debugger removing unset bps
		for (let i = 0; i < debuggerPBs.length; i++) {
		 	const ln = debuggerPBs[i];
			if (editorBPs.indexOf(ln) < 0) {
				await this.perlDebugger.clearBreakPoint(ln, debugPath);
			}
		}

		// Add missing bps to the debugger
		for (let i = 0; i < editorBPs.length; i++) {
		 	const ln = editorBPs[i];
			if (debuggerPBs.indexOf(ln) < 0) {
				try {
					const res = await this.perlDebugger.setBreakPoint(ln, debugPath);
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
			.catch(err => this.sendResponse(response));
	}

	/**
	 * Next
	 */
	protected nextRequest(response: DebugProtocol.NextResponse, args: DebugProtocol.NextArguments): void {
		this.perlDebugger.request('n')
			.then((res) => {
				if (res.ln) {
					this._currentLine = this.convertDebuggerLineToClient(res.ln);
				}

				this.sendResponse(response);

				if (res.finished) {
					this.sendEvent(new TerminatedEvent());
				} else {
					this.sendEvent(new StoppedEvent("step", PerlDebugSession.THREAD_ID));
				}
				// no more lines: run to end
			})
			.catch(err => {
				this.sendEvent(new OutputEvent(`ERR>Continue error: ${err.message}\n`));
				this.sendResponse(response);
				if (err.finished) {
					this.sendEvent(new TerminatedEvent());
				}
			});
	}


	/**
	 * Continue
	 */
	protected continueRequest(response: DebugProtocol.ContinueResponse, args: DebugProtocol.ContinueArguments): void {
		this.perlDebugger.request('c')
			.then((res) => {
				if (res.ln) {
					this._currentLine = this.convertDebuggerLineToClient(res.ln);
				}
				this.sendResponse(response);

				if (res.finished) {
					this.sendEvent(new TerminatedEvent());
				} else {
					this.sendEvent(new StoppedEvent("breakpoint", PerlDebugSession.THREAD_ID));
				}
			})
			.catch((err) => {
				this.sendEvent(new OutputEvent(`ERR>Continue error: ${err.message}\n`));
				this.sendEvent(new TerminatedEvent());
				this.sendResponse(response);
			});
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

	/**
	 * Variable scope
	 */
	protected variablesRequest(response: DebugProtocol.VariablesResponse, args: DebugProtocol.VariablesArguments): void {
		const id = this._variableHandles.get(args.variablesReference);

		this.perlDebugger.variableList({
			global_0: 0,
			local_0: 1,
			closure_0: 2,
		})
			.then(variables => {
				const result = [];

				if (id != null && variables[id]) {
					const len = variables[id].length;
					const result = variables[id].map(variable => {
						if (variable.variablesReference === '0') {
							variable.variablesReference = 0;
						} else {
							variable.variablesReference = this._variableHandles.create(variable.variablesReference);
						}
						return variable;
					});

					response.body = {
						variables: result
					};
					this.sendResponse(response);
				} else {
					this.sendResponse(response);
				}
			})
			.catch(() => {
				this.sendResponse(response);
			});
	}

	/**
	 * Evaluate
	 */
	protected evaluateRequest(response: DebugProtocol.EvaluateResponse, args: DebugProtocol.EvaluateArguments): void {

		if (args.context === 'repl') {
			this.perlDebugger.request(args.expression)
				.then((res) => {
					if (res.data.length > 1) {
						res.data.forEach((line) => {
							this.sendEvent(new OutputEvent(`> ${line}\n`));
						});
						response.body = {
							result: `Result:`,
							variablesReference: 0
						};
					} else {
						response.body = {
							result: `${res.data[0]}`,
							variablesReference: 0
						};
					}
					this.sendResponse(response);
				});
		} else {
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
		const stacktrace = await this.perlDebugger.getStackTrace();
		const frames = new Array<StackFrame>();
		stacktrace.forEach((trace, i) => {
			frames.push(new StackFrame(i, `${trace.caller}`, new Source(basename(trace.filename),
				this.convertDebuggerPathToClient(trace.filename)),
				trace.ln, 0));
		});

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
				this.sendEvent(new OutputEvent(`--->Trace error...${err.message}\n`));
				response.body = {
					stackFrames: [],
					totalFrames: 0
				};
				this.sendResponse(response);
			});
	}
}

DebugSession.run(PerlDebugSession);
