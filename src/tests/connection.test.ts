import assert = require('assert');
import asyncAssert from './asyncAssert';
import * as Path from 'path';
import { perlDebuggerConnection, RequestResponse } from '../adapter';
import { LocalSession } from '../localSession';

const PROJECT_ROOT = Path.join(__dirname, '../../');
const DATA_ROOT = Path.join(PROJECT_ROOT, 'src/tests/data/');

const FILE_TEST_PL = 'slow_test.pl';
const FILE_TEST_NESTED_PL = 'test_nested.pl';
const FILE_MODULE = Path.resolve(DATA_ROOT, 'Module.pm');
const FILE_NESTED_MODULE = 'Module2.pm';
const FILE_FICTIVE = 'Fictive.pl';
const FILE_BROKEN_SYNTAX = 'broken_syntax.pl';
const FILE_BROKEN_CODE = 'broken_code.pl';
const FILE_PRINT_ARGUMENTS = 'print_arguments.pl';
const FILE_FAST_TEST_PL = 'fast_test.pl';

const launchOptions = {
	env: {
		PATH: process.env.PATH || '',
		PERL5LIB: process.env.PERL5LIB || '',
	},
	console: 'deprecatedDebugConsole'
};

describe('Perl debugger connection', () => {

	let conn: perlDebuggerConnection;

	beforeEach(() => {
		conn = new perlDebuggerConnection(null);
		return conn.initializeRequest();
	});

	afterEach(() => {
		conn.destroy();
		conn = null;
	});

	describe('launchRequest', () => {
		it('Should be able to connect and launch ' + FILE_TEST_PL, async () => {
			const res = await conn.launchRequest(FILE_TEST_PL, DATA_ROOT, [], launchOptions);
			assert.equal(res.finished, false);
			assert.equal(res.exception, false);
			assert.equal(res.ln, 7); // The first code line in test.pl is 5
		});

		it('Should be able to connect and launch ' + FILE_BROKEN_CODE, async () => {
			const res = await conn.launchRequest(FILE_BROKEN_CODE, DATA_ROOT, [], launchOptions);
			assert.equal(res.finished, false);
			assert.equal(res.exception, false);
			assert.equal(res.ln, 7);
		});

		it('Should be able to connect and launch remote ' + FILE_TEST_PL, async () => {
			const port = 5000 + Math.round(Math.random()*100); // Not to conflict with VS Code jest ext
			// Listen for remote debugger session
			const server = conn.launchRequest(FILE_TEST_PL, DATA_ROOT, [], {
				...launchOptions,
				port, // Trigger server
			});
			// Start "remote" debug session
			const local = new LocalSession(FILE_TEST_PL, DATA_ROOT, [], {
				...launchOptions,
				env: {
					...launchOptions.env,
					PERLDB_OPTS: `RemotePort=localhost:${port}`, // Trigger remote debugger
				},
			});

			// Wait for result
			const res = await server;

			// Cleanup
			local.kill();
			conn.perlDebugger.kill();

			assert.equal(local.title(), `perl -d ${FILE_TEST_PL}`);
			assert.equal(res.finished, false);
			assert.equal(res.exception, false);
			assert.equal(res.ln, 7); // The first code line in test.pl is 5
		});

		it('Should error when launching ' + FILE_BROKEN_SYNTAX, async () => {
			const res = <RequestResponse>await asyncAssert.throws(conn.launchRequest(FILE_BROKEN_SYNTAX, DATA_ROOT, [], launchOptions));

			assert.equal(res.exception, true, 'Response should have exception set true');
			assert.equal(res.errors.length, 2, 'Response errors should be 2');
			assert.equal(res.finished, true, 'Response finished should be set true');
		});

		it('Should take arguments ' + FILE_PRINT_ARGUMENTS, async () => {
			const res = await conn.launchRequest(FILE_PRINT_ARGUMENTS, DATA_ROOT, [], {
				args: ['foo=bar', 'test=ok'],
				...launchOptions,
			});

			const argv = await conn.getExpressionValue('"@ARGV"');
			await conn.continue();
			// xxx: It would have been nice if we had a stable way of catching the application output
			// using the actual application output for validation
			assert.equal(argv, 'foo=bar test=ok')
		});
	});

	describe('setFileContext', () => {
		it('Should be able to set file context', async () => {
			await conn.launchRequest(FILE_TEST_PL, DATA_ROOT, [], launchOptions);
			await conn.setFileContext(FILE_MODULE);
		});

		it('Should be able to set file context on same file twice', async () => {
			await conn.launchRequest(FILE_TEST_PL, DATA_ROOT, [], launchOptions);
			await conn.setFileContext(FILE_MODULE);
			await conn.setFileContext(FILE_MODULE);
		});

		it('Should throw on unknown file', async () => {
			await conn.launchRequest(FILE_TEST_PL, DATA_ROOT, [], launchOptions);
			await asyncAssert.throws(conn.setFileContext(FILE_FICTIVE));
		});
	});

	describe('setBreakPoint', () => {
		it('Should be able to set break point on line 7 in current file', async () => {
			await conn.launchRequest(FILE_TEST_PL, DATA_ROOT, [], launchOptions);
			await conn.setBreakPoint(7);
		});
		it('Should not be able to set breakpoint on line 9 in current file', async () => {
			await conn.launchRequest(FILE_TEST_PL, DATA_ROOT, [], launchOptions);
			await asyncAssert.throws(conn.setBreakPoint(9));
		});
		it('Should be able to set break point on line 7 in ' + FILE_TEST_PL, async () => {
			await conn.launchRequest(FILE_TEST_PL, DATA_ROOT, [], launchOptions);
			await conn.setBreakPoint(7, FILE_TEST_PL);
		});
		it('Should not be able to set breakpoint on line 9 in ' + FILE_TEST_PL, async () => {
			await conn.launchRequest(FILE_TEST_PL, DATA_ROOT, [], launchOptions);
			await asyncAssert.throws(conn.setBreakPoint(9, FILE_TEST_PL));
		});
		it('Should be able to set break point on line 4 in ' + FILE_MODULE, async () => {
			await conn.launchRequest(FILE_TEST_PL, DATA_ROOT, [], launchOptions);
			await conn.setBreakPoint(4, FILE_MODULE);
		});
		it('Should not be able to set breakpoint on line 3 in ' + FILE_MODULE, async () => {
			await conn.launchRequest(FILE_TEST_PL, DATA_ROOT, [], launchOptions);
			await asyncAssert.throws(conn.setBreakPoint(3, FILE_MODULE));
		});
		it('Should not be able to set breakpoint on line 7 in ' + FILE_FICTIVE, async () => {
			await conn.launchRequest(FILE_TEST_PL, DATA_ROOT, [], launchOptions);
			await asyncAssert.throws(conn.setBreakPoint(7, FILE_FICTIVE));
		});
	});

	describe('getBreakPoints', () => {
		it('Should work if no breakpoints are added', async () => {
			await conn.launchRequest(FILE_TEST_PL, DATA_ROOT, [], launchOptions);
			assert.deepEqual(await conn.getBreakPoints(), {});
		});
		it('Should work if only one file is added', async () => {
			await conn.launchRequest(FILE_TEST_PL, DATA_ROOT, [], launchOptions);
			await conn.setBreakPoint(7);
			assert.deepEqual(await conn.getBreakPoints(), { [FILE_TEST_PL]: [ 7 ] });
		});
		it('Should work if multiple breakpoints are added for one file', async () => {
			await conn.launchRequest(FILE_TEST_PL, DATA_ROOT, [], launchOptions);
			await conn.setBreakPoint(7);
			await conn.setBreakPoint(8);
			await conn.setBreakPoint(10);
			await conn.setBreakPoint(11);
			await conn.setBreakPoint(12);
			await conn.setBreakPoint(13);
			assert.deepEqual(await conn.getBreakPoints(), { [FILE_TEST_PL]: [ 7, 8, 10, 11, 12, 13 ] });
		});
		it('Should work if multiple breakpoints are added for multiple files', async () => {
			await conn.launchRequest(FILE_TEST_PL, DATA_ROOT, [], launchOptions);
			await conn.setBreakPoint(7);
			await conn.setBreakPoint(10, FILE_TEST_PL);
			await conn.setBreakPoint(11, FILE_TEST_PL);
			await conn.setBreakPoint(12, FILE_TEST_PL);
			await conn.setBreakPoint(13, FILE_TEST_PL);

			await conn.setBreakPoint(4, FILE_MODULE);
			await conn.setBreakPoint(5, FILE_MODULE);
			// Let's do something out of order...
			await conn.setBreakPoint(8);
			// Let's try setting the same breakpoint twice...
			await conn.setBreakPoint(5, FILE_MODULE);

			assert.deepEqual(await conn.getBreakPoints(), { [FILE_TEST_PL]: [ 7, 8, 10, 11, 12, 13 ], [FILE_MODULE]: [ 4, 5 ] });
		});
	});

	describe('clearBreakPoint', () => {
		it('Should allow clearing one breakpoint', async () => {
			await conn.launchRequest(FILE_TEST_PL, DATA_ROOT, [], launchOptions);
			await conn.setBreakPoint(7);
			await conn.setBreakPoint(8);
			await conn.setBreakPoint(10, FILE_TEST_PL);
			await conn.setBreakPoint(11, FILE_TEST_PL);
			await conn.setBreakPoint(12, FILE_TEST_PL);
			await conn.setBreakPoint(13, FILE_TEST_PL);

			await conn.setBreakPoint(4, FILE_MODULE);
			await conn.setBreakPoint(5, FILE_MODULE);

			assert.deepEqual(await conn.getBreakPoints(), { [FILE_TEST_PL]: [ 7, 8, 10, 11, 12, 13 ], [FILE_MODULE]: [ 4, 5 ] });

			await conn.clearBreakPoint(7);
			await conn.clearBreakPoint(10, FILE_TEST_PL);
			await conn.clearBreakPoint(5, FILE_MODULE);

			assert.deepEqual(await conn.getBreakPoints(), { [FILE_TEST_PL]: [ 8, 11, 12, 13 ], [FILE_MODULE]: [ 4 ] });

		});
	});

	describe('clearBreakPoint', () => {
		it('Should allow clearing all breakpoints', async () => {
			await conn.launchRequest(FILE_TEST_PL, DATA_ROOT, [], launchOptions);
			await conn.setBreakPoint(7);
			await conn.setBreakPoint(10, FILE_TEST_PL);
			await conn.setBreakPoint(4, FILE_MODULE);

			assert.deepEqual(await conn.getBreakPoints(), { [FILE_MODULE]: [ 4 ], [FILE_TEST_PL]: [ 7, 10 ] });

			await conn.clearAllBreakPoints();

			assert.deepEqual(await conn.getBreakPoints(), { });

		});
	});

	describe('Test debugger', () => {
		describe('continue', () => {
			it('Should leave us at line 11 in ' + FILE_TEST_PL, async () => {
				await conn.launchRequest(FILE_TEST_PL, DATA_ROOT, [], launchOptions);
				await conn.setBreakPoint(11, FILE_TEST_PL);
				const res = await conn.continue();
				assert.equal(res.ln, 11);
			});

			it('Should throw an error ' + FILE_BROKEN_CODE, async () => {
				await conn.launchRequest(FILE_BROKEN_CODE, DATA_ROOT, [], launchOptions);
				await conn.setBreakPoint(11, FILE_BROKEN_CODE);
				// In between we have broken code
				await conn.setBreakPoint(13, FILE_BROKEN_CODE);

				const res = await conn.continue();
				assert.equal(res.ln, 11);
				// In between we have broken code
				const res_broken = <RequestResponse>await asyncAssert.throws(conn.continue());

				assert.equal(res_broken.finished, true);
				assert.equal(res_broken.errors.length, 1);
			});
		});

		describe('next', () => {
			it('Should go to next statement', async () => {
				let res = await conn.launchRequest(FILE_TEST_PL, DATA_ROOT, [], launchOptions);
				assert.equal(res.ln, 7);
				res = await conn.next();
				assert.equal(res.ln, 8);
			});
		});

		describe('getPadwalkerVersion', () => {
			it('should return version of installed padwalker', async () => {
				await conn.launchRequest(FILE_TEST_PL, DATA_ROOT, [], launchOptions);
				expect(conn.padwalkerVersion).toBeDefined();
				expect(conn.padwalkerVersion.length).toBeGreaterThan(1);
				expect(Number(conn.padwalkerVersion)).toBeGreaterThan(1);
			});
		});

		describe('getVariableList', () => {
			it('Should get more scope variables types', async function() {
				await conn.launchRequest(FILE_TEST_PL, DATA_ROOT, [], launchOptions);
				await conn.setBreakPoint(23, FILE_MODULE);

				await conn.continue();

				const vars0 = await conn.getVariableList(0);
				const actual = Object.keys(vars0).length;
				const expected = [0, 44, 45, 46]; // xxx: Investigate 44+46 might be a perser issue
				assert(expected.indexOf(actual) > -1, 'variable count level 0, actual: ' +
						actual + ' expected: ' + expected.join(' or '));

				const vars1 = await conn.getVariableList(1);
				assert.equal(Object.keys(vars1).length, 7, 'variable count level 1');
				const vars2 = await conn.getVariableList(2);
				assert.equal(Object.keys(vars2).length, 1, 'variable count level 2');
				const vars3 = await conn.getVariableList(3);
				assert.equal(Object.keys(vars3).length, 0, 'variable count level 3');
			});
		});

		describe('restart', () => {
			it('Should start from the beginning', async () => {
				let res = await conn.launchRequest(FILE_TEST_PL, DATA_ROOT, [], launchOptions);
				assert.equal(res.ln, 7);
				res = await conn.next();
				assert.equal(res.ln, 8);
				res = await conn.restart();
				if (/^win/.test(process.platform)) {
					// xxx: On windows we ned to respawn the debugger
					// it might be "inhibit_exit" is not working on windows
					// causing us to workaround...
				} else {
					assert.equal(res.ln, 7);
				}
			});
		});

		describe.skip('resolveFilename', () => {
			it('Should resolve filenames', async () => {
				let res = await conn.launchRequest(FILE_TEST_NESTED_PL, DATA_ROOT, [], launchOptions);
				assert.equal(res.ln, 6);
				const perl5dbPath = await conn.resolveFilename('perl5db.pl');
				// /System/Library/Perl/5.18/perl5db.pl
				assert.ok(/perl5db\.pl$/.test(perl5dbPath), `Expected resolved path to contain the filename, got "${perl5dbPath}"`);
				assert.ok(perl5dbPath.length > 'perl5db.pl'.length, 'Expected full path in resolved filename');

				const testPath = await conn.resolveFilename(FILE_TEST_NESTED_PL);
				assert.equal(testPath, '?');

				const modulePath = await conn.resolveFilename(FILE_NESTED_MODULE);
				assert.equal(modulePath, '?');

				const moduleNestedPath = await conn.resolveFilename(FILE_MODULE);
				assert.equal(moduleNestedPath, '?');
			});
		});
	});
});
