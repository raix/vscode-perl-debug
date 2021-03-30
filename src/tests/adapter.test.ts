import assert = require('assert');
import * as Path from 'path';
import * as fs from 'fs';
import {DebugClient} from 'vscode-debugadapter-testsupport';
import {DebugProtocol} from 'vscode-debugprotocol';
import { Subject } from 'await-notify';
import { platform } from 'os';

describe('Perl debug Adapter', () => {
	const DEBUG_ADAPTER = './out/debugAdapter.js';

	const PROJECT_ROOT = Path.dirname(Path.dirname(__dirname));
	const DATA_ROOT = Path.join(PROJECT_ROOT, 'src', 'tests', 'data');

	const FILE_TEST_PL = 'slow_test.pl';
	const FILE_TEST_NESTED_PL = 'test_nested.pl';
	const FILE_MODULE = 'Module.pm';
	const FILE_NESTED_MODULE = 'Module2.pm';
	const FILE_FICTIVE = 'Fictive.pl';
	const FILE_BROKEN_SYNTAX = 'broken_syntax.pl';
	const FILE_BROKEN_CODE = 'broken_code.pl';
	const FILE_PRINT_ARGUMENTS = 'print_arguments.pl';
	const FILE_FAST_TEST_PL = 'fast_test.pl';
	const FILE_LONG_RUNNING_PL = 'long_running.pl';
	const FILE_VARS_TEST_PL = "vars_test.pl";

	const PERL_DEBUG_LOG = 'perl_debugger.log';

	const defaultLaunchConfig = {
		type: 'perl',
		request: 'launch',
		exec: 'perl',
		execArgs: [],
		name: 'Perl-Debug',
		root: DATA_ROOT,
		program: Path.join(DATA_ROOT, FILE_FAST_TEST_PL),
		inc: [],
		args: [],
		env: {
			// User perlbrew installations should take priority over system
			// Perl installations.
			PATH: process.env.PATH,
		},
		stopOnEntry: false,
		console: 'none',
		trace: false,
	};

	const Configuration = (obj: Object) => {
		return Object.assign({}, defaultLaunchConfig, obj);
	};

	const printLogFile = () => {
		const logfile = Path.join(PROJECT_ROOT, PERL_DEBUG_LOG);
    if (defaultLaunchConfig.trace) {
			if (fs.existsSync(logfile)) {
				console.log('Dubug Adapter Log file:');
				console.log(fs.readFileSync(logfile, 'utf8'));
			} else {
				console.log('No log file found');
			}
		}
	};

	const getScopedVars = async (
		dc: DebugClient,
		frameId: number,
		name: string,
	): Promise<DebugProtocol.VariablesResponse> => {

		const st = await dc.stackTraceRequest({
			threadId: undefined
		});

		const scopes = await dc.scopesRequest({
			frameId: st.body.stackFrames[frameId].id
		});

		const vars = await dc.variablesRequest({
			variablesReference: scopes.body.scopes.filter(
				x => x.name === name
			)[0].variablesReference
		});

		return vars;

	};

	let dc: DebugClient;

	beforeEach(async () => {
		dc = new DebugClient('node', DEBUG_ADAPTER, 'perl');
		dc.defaultTimeout = 60000;
		await dc.start();
	});

	afterEach(async () => {
		await dc.stop();
		printLogFile();
	});

	describe('basic', () => {

		it('unknown request should produce error', done => {
			dc.send('illegal_request').then(() => {
				done(new Error("does not report error on unknown request"));
			}).catch(() => {
				done();
			});
		});
	});

	describe('initialize', () => {

		it('should return supported features', () => {
			return dc.initializeRequest().then(response => {
				assert.equal(response.body.supportsConfigurationDoneRequest, true);
			});
		});

		it('should produce error for invalid \'pathFormat\'', done => {
			dc.initializeRequest({
				adapterID: 'mock',
				linesStartAt1: true,
				columnsStartAt1: true,
				pathFormat: 'url'
			}).then(response => {
				done(new Error("does not report error on invalid 'pathFormat' attribute"));
			}).catch(err => {
				// error expected
				done();
			});
		});
	});

	describe('launch', () => {

		it('should run program to the end', async () => {

			const PROGRAM = FILE_FAST_TEST_PL;

			assert.ok(
				fs.existsSync(Path.join(DATA_ROOT, PROGRAM)),
				`Test program "${PROGRAM}" not found`
			);

			await Promise.all([
				dc.waitForEvent('initialized'),
				dc.waitForEvent('terminated'),
				dc.launch(Configuration({
					program: PROGRAM,
					stopOnEntry: false,
					console: 'none'
				})),
			]);
		});

		it('should stop on entry', async () => {

			const PROGRAM = FILE_FAST_TEST_PL;

			assert.ok(
				fs.existsSync(Path.join(DATA_ROOT, PROGRAM)),
				`Test program "${PROGRAM}" not found`
			);

			const ENTRY_LINE = 7;

			await dc.launch(Configuration({
				program: PROGRAM,
				stopOnEntry: true,
				console: 'none'
			}));

			await dc.assertStoppedLocation('entry', { line: ENTRY_LINE } );
		});
	});

	describe('variables', () => {

		it('variable retrieval should work', async () => {

			await dc.launch(Configuration({
				program: FILE_VARS_TEST_PL,
				stopOnEntry: true
			}));

			const globalVars = await getScopedVars(dc, 0, 'Global');

			const perlVer = globalVars.body.variables.filter(
				x => x.name === '$]'
			)[0];

			assert.ok(/^5\./.test(perlVer.value));

			const bpRespone = await dc.setBreakpointsRequest({
				source: {
					path: FILE_VARS_TEST_PL,
				},
				lines: [17],
			});

			assert(bpRespone.success, 'set breakpoint');

			await Promise.all([
				dc.continueRequest({ threadId: undefined }),
				dc.assertStoppedLocation('breakpoint', {
					line: 17
				})
			]);

			const lexicals1 = async () => {

				const lexicalVars = await getScopedVars(dc, 0, 'Lexical');

				assert.ok(
					lexicalVars.body.variables.filter(
						x => x.name === '$PKG_MY' && x.value.indexOf('PKG_MY') > 0
					).length > 0,
					'can see a PKG_MY variable'
				);

				assert.ok(
					lexicalVars.body.variables.filter(
						x => x.name === '$arg' && x.value.indexOf('inner') > 0
					).length > 0,
					'can see a arg variable'
				);

				assert.ok(
					lexicalVars.body.variables.filter(
						x => x.name === '$outer_my' && x.value.indexOf('outer_my') > 0
					).length === 0,
					'cannot see a $outer_my variable from other stack frame'
				);

				const globalVars = await getScopedVars(dc, 0, 'Global');

				assert.ok(
					globalVars.body.variables.filter(
						x => x.name === '$/'
						&&
						x.value.toLowerCase().indexOf('20ac') > 0
					).length > 0,
					'can see a localised $/ variable set to EURO sign'
				);

			};

			const lexicals2 = async () => {

				const lexicalVars = await getScopedVars(dc, 1, 'Lexical');

				assert.ok(
					lexicalVars.body.variables.filter(
						x => x.name === '$outer_my' && x.value.indexOf('outer_my') > 0
					).length > 0,
					'can see a $outer_my variable in middle stack frame'
				);

			};

			await lexicals1();
			await lexicals2();

		});

	});

	describe('pause', () => {

		(platform() === "win32" ? it.skip : it)('should be able to pause programs', async () => {
			const PROGRAM = Path.join(DATA_ROOT, FILE_LONG_RUNNING_PL);

			// NOTE(bh): This test is probably expected to fail when test
			// and adapter run in the same process?

			await dc.launch(Configuration({
				program: FILE_LONG_RUNNING_PL,
				stopOnEntry: true
			}));

			dc.continueRequest({
				threadId: undefined
			});

			// NOTE(bh): Perl's built-in `sleep` function only supports
			// integer resolution sleeps, so this test is a bit slow.

			await new Promise(resolve => setTimeout(resolve, 1200));

			await dc.pauseRequest({
				threadId: undefined,
			});

			// The evaluate request can only succeed within a few seconds
			// if the debuggee is actually stopped, otherwise the debugger
			// would not take our request in time because it's on the same
			// thread as the debuggee. If things do not go according to
			// plan and the debuggee keeps running, it will be killed by
			// the test runner due to a timeout since the script runs for
			// around 30 seconds, longer than the timeout.

			const result = await dc.evaluateRequest({
				context: 'repl',
				expression: 'p $_'
			});

			assert.ok(
				parseInt(result.body.result, 10) > 2,
				'must have gone at least once through the loop'
			);

		});
	});

	describe('setFunctionBreakpoints', () => {

		it('should stop on a function', async () => {

			dc.on('perl-debug.streamcatcher.data', (x) => {
				console.log(x);
			});

			await Promise.all([
				dc.launch(Configuration({
					program: FILE_FAST_TEST_PL,
					stopOnEntry: true
				})),
				dc.waitForEvent('stopped'),
			]);

			await dc.setFunctionBreakpointsRequest({
				breakpoints: [{
					name: 'Module::test'
				}]
			});

			const hitFunctionBreakpoint = new Subject();

			dc.on('stopped', async (x) => {

				hitFunctionBreakpoint.notify();

				const st = await dc.stackTraceRequest({
					threadId: undefined
				});

				assert.ok(
					st.body.stackFrames.filter(x => {
						return (
							x.source.path.endsWith('Module.pm')
							&&
							x.line === 4
						);
					}).length > 0
				);

				// Should now run to completion
				await Promise.all([
					// Clear breakpoints
					dc.setFunctionBreakpointsRequest({
						breakpoints: []
					}),
					dc.continueRequest({
						threadId: undefined
					}),
					dc.waitForEvent('terminated')
				]);

			});

			await Promise.all([
				dc.continueRequest({
					threadId: undefined
				}),
				hitFunctionBreakpoint
			]);

		});
	});

	// xxx: Need to figure out this test
	// hint: It might be a missing "stop" event - is the application run?
	describe.skip('setBreakpoints', () => {

		const PROGRAM = FILE_FAST_TEST_PL;

		it('should stop on a breakpoint', async () => {
			const BREAKPOINT_LINE = 10;

			assert.ok(
				fs.existsSync(Path.join(DATA_ROOT, PROGRAM)),
				`Test program "${PROGRAM}" not found`
			);

			await dc.hitBreakpoint(Configuration({ program: PROGRAM }), { path: PROGRAM, line: BREAKPOINT_LINE } );
		});

		it.skip('hitting a lazy breakpoint should send a breakpoint event', () => {

			const PROGRAM = Path.join(FILE_FAST_TEST_PL);
			const BREAKPOINT_LINE = 7;

			return Promise.all([
				dc.waitForEvent('breakpoint').then((event : DebugProtocol.BreakpointEvent ) => {
					assert.equal(event.body.breakpoint.verified, true, "event mismatch: verified");
				}),
				dc.hitBreakpoint(({ program: PROGRAM }), { path: PROGRAM, line: BREAKPOINT_LINE, verified: false } ),
			]);

		});

	});

	// TODO: Need to be able to replicate this
	describe.skip('setExceptionBreakpoints', () => {

		it('should stop on an exception', () => {

			const PROGRAM_WITH_EXCEPTION = Path.join(DATA_ROOT, FILE_BROKEN_CODE);
			const EXCEPTION_LINE = 10;

			return Promise.all([

				dc.waitForEvent('initialized').then(event => {
					return dc.setExceptionBreakpointsRequest({
						filters: [ 'all' ]
					});
				}).then(response => {
					return dc.configurationDoneRequest();
				}),

				dc.launch(Configuration({ program: PROGRAM_WITH_EXCEPTION })),

				dc.assertStoppedLocation('exception', { line: EXCEPTION_LINE } )
			]);
		});
	});
});
