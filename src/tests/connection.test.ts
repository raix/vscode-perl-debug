import assert = require('assert');
import asyncAssert from './asyncAssert';
import * as Path from 'path';
import { perlDebuggerConnection, RequestResponse } from '../adapter';

const PROJECT_ROOT = Path.join(__dirname, '../../');
const DATA_ROOT = Path.join(PROJECT_ROOT, 'src/tests/data/');

const FILE_TEST_PL = 'slow_test.pl';
const FILE_TEST_NESTED_PL = 'test_nested.pl';
const FILE_MODULE = 'Module.pm';
const FILE_NESTED_MODULE = 'Module2.pm';
const FILE_FICTIVE = 'Fictive.pl';
const FILE_BROKEN_SYNTAX = 'broken_syntax.pl';
const FILE_BROKEN_CODE = 'broken_code.pl';
const FILE_PRINT_ARGUMENTS = 'print_arguments.pl';
const FILE_FAST_TEST_PL = 'fast_test.pl';

suite('Perl debugger connection', () => {

	let conn: perlDebuggerConnection;

	setup(() => {
		conn = new perlDebuggerConnection();
		return conn.initializeRequest();
	});

	teardown(() => {
		conn.destroy();
		conn = null;
	});

	suite('launchRequest', () => {
		test('Should be able to connect and launch ' + FILE_TEST_PL, async () => {
			const res = await conn.launchRequest(FILE_TEST_PL, DATA_ROOT, []);
			assert.equal(res.finished, false);
			assert.equal(res.exception, false);
			assert.equal(res.ln, 5); // The first code line in test.pl is 5
		});

		test('Should be able to connect and launch ' + FILE_BROKEN_CODE, async () => {
			const res = await conn.launchRequest(FILE_BROKEN_CODE, DATA_ROOT, []);
			assert.equal(res.finished, false);
			assert.equal(res.exception, false);
			assert.equal(res.ln, 5);
		});

		test('Should error when launching ' + FILE_BROKEN_SYNTAX, async () => {
			const res = <RequestResponse>await asyncAssert.throws(conn.launchRequest(FILE_BROKEN_SYNTAX, DATA_ROOT, []));

			assert.equal(res.exception, true, 'Response should have exception set true');
			assert.equal(res.errors.length, 2, 'Response errors should be 2');
			assert.equal(res.finished, true, 'Response finished should be set true');
		});

		test('Should take arguments ' + FILE_PRINT_ARGUMENTS, async () => {
			const res = await conn.launchRequest(FILE_PRINT_ARGUMENTS, DATA_ROOT, [], {
				args: ['foo=bar', 'test=ok'],
			});
			await conn.continue();
			// xxx: It would have been nice if we had a stable way of catching the application output
			// using the actual application output for validation
			assert.equal(conn.commandRunning, 'perl -d print_arguments.pl foo=bar test=ok')
		});
	});

	suite('setFileContext', () => {
		test('Should be able to set file context', async () => {
			await conn.launchRequest(FILE_TEST_PL, DATA_ROOT, []);
			await conn.setFileContext(FILE_MODULE);
		});

		test('Should be able to set file context on same file twice', async () => {
			await conn.launchRequest(FILE_TEST_PL, DATA_ROOT, []);
			await conn.setFileContext(FILE_MODULE);
			await conn.setFileContext(FILE_MODULE);
		});

		test('Should throw on unknown file', async () => {
			await conn.launchRequest(FILE_TEST_PL, DATA_ROOT, []);
			await asyncAssert.throws(conn.setFileContext(FILE_FICTIVE));
		});
	});

	suite('setBreakPoint', () => {
		test('Should be able to set break point on line 5 in current file', async () => {
			await conn.launchRequest(FILE_TEST_PL, DATA_ROOT, []);
			await conn.setBreakPoint(5);
		});
		test('Should not be able to set breakpoint on line 7 in current file', async () => {
			await conn.launchRequest(FILE_TEST_PL, DATA_ROOT, []);
			await asyncAssert.throws(conn.setBreakPoint(7));
		});
		test('Should be able to set break point on line 5 in ' + FILE_TEST_PL, async () => {
			await conn.launchRequest(FILE_TEST_PL, DATA_ROOT, []);
			await conn.setBreakPoint(5, FILE_TEST_PL);
		});
		test('Should not be able to set breakpoint on line 7 in ' + FILE_TEST_PL, async () => {
			await conn.launchRequest(FILE_TEST_PL, DATA_ROOT, []);
			await asyncAssert.throws(conn.setBreakPoint(7, FILE_TEST_PL));
		});
		test('Should be able to set break point on line 4 in ' + FILE_MODULE, async () => {
			await conn.launchRequest(FILE_TEST_PL, DATA_ROOT, []);
			await conn.setBreakPoint(4, FILE_MODULE);
		});
		test('Should not be able to set breakpoint on line 3 in ' + FILE_MODULE, async () => {
			await conn.launchRequest(FILE_TEST_PL, DATA_ROOT, []);
			await asyncAssert.throws(conn.setBreakPoint(3, FILE_MODULE));
		});
		test('Should not be able to set breakpoint on line 5 in ' + FILE_FICTIVE, async () => {
			await conn.launchRequest(FILE_TEST_PL, DATA_ROOT, []);
			await asyncAssert.throws(conn.setBreakPoint(5, FILE_FICTIVE));
		});
	});

	suite('getBreakPoints', () => {
		test('Should work if no breakpoints are added', async () => {
			await conn.launchRequest(FILE_TEST_PL, DATA_ROOT, []);
			assert.deepEqual(await conn.getBreakPoints(), {});
		});
		test('Should work if only one file is added', async () => {
			await conn.launchRequest(FILE_TEST_PL, DATA_ROOT, []);
			await conn.setBreakPoint(5);
			assert.deepEqual(await conn.getBreakPoints(), { [FILE_TEST_PL]: [ 5 ] });
		});
		test('Should work if multiple breakpoints are added for one file', async () => {
			await conn.launchRequest(FILE_TEST_PL, DATA_ROOT, []);
			await conn.setBreakPoint(5);
			await conn.setBreakPoint(6);
			await conn.setBreakPoint(8);
			await conn.setBreakPoint(9);
			await conn.setBreakPoint(10);
			await conn.setBreakPoint(11);
			assert.deepEqual(await conn.getBreakPoints(), { [FILE_TEST_PL]: [ 5, 6, 8, 9, 10, 11 ] });
		});
		test('Should work if multiple breakpoints are added for multiple files', async () => {
			await conn.launchRequest(FILE_TEST_PL, DATA_ROOT, []);
			await conn.setBreakPoint(5);
			await conn.setBreakPoint(8, FILE_TEST_PL);
			await conn.setBreakPoint(9, FILE_TEST_PL);
			await conn.setBreakPoint(10, FILE_TEST_PL);
			await conn.setBreakPoint(11, FILE_TEST_PL);

			await conn.setBreakPoint(4, FILE_MODULE);
			await conn.setBreakPoint(5, FILE_MODULE);
			// Let's do something out of order...
			await conn.setBreakPoint(6);
			// Let's try setting the same breakpoint twice...
			await conn.setBreakPoint(5, FILE_MODULE);

			assert.deepEqual(await conn.getBreakPoints(), { [FILE_TEST_PL]: [ 5, 6, 8, 9, 10, 11 ], [FILE_MODULE]: [ 4, 5 ] });
		});
	});

	suite('clearBreakPoint', () => {
		test('Should allow clearing one breakpoint', async () => {
			await conn.launchRequest(FILE_TEST_PL, DATA_ROOT, []);
			await conn.setBreakPoint(5);
			await conn.setBreakPoint(6);
			await conn.setBreakPoint(8, FILE_TEST_PL);
			await conn.setBreakPoint(9, FILE_TEST_PL);
			await conn.setBreakPoint(10, FILE_TEST_PL);
			await conn.setBreakPoint(11, FILE_TEST_PL);

			await conn.setBreakPoint(4, FILE_MODULE);
			await conn.setBreakPoint(5, FILE_MODULE);

			assert.deepEqual(await conn.getBreakPoints(), { [FILE_TEST_PL]: [ 5, 6, 8, 9, 10, 11 ], [FILE_MODULE]: [ 4, 5 ] });

			await conn.clearBreakPoint(5);
			await conn.clearBreakPoint(8, FILE_TEST_PL);
			await conn.clearBreakPoint(5, FILE_MODULE);

			assert.deepEqual(await conn.getBreakPoints(), { [FILE_TEST_PL]: [ 6, 9, 10, 11 ], [FILE_MODULE]: [ 4 ] });

		});
	});

	suite('clearBreakPoint', () => {
		test('Should allow clearing all breakpoints', async () => {
			await conn.launchRequest(FILE_TEST_PL, DATA_ROOT, []);
			await conn.setBreakPoint(5);
			await conn.setBreakPoint(8, FILE_TEST_PL);
			await conn.setBreakPoint(4, FILE_MODULE);

			assert.deepEqual(await conn.getBreakPoints(), { [FILE_MODULE]: [ 4 ], [FILE_TEST_PL]: [ 5, 8 ] });

			await conn.clearAllBreakPoints();

			assert.deepEqual(await conn.getBreakPoints(), { });

		});
	});

	suite('Test debugger', () => {
		suite('continue', () => {
			test('Should leave us at line 9 in ' + FILE_TEST_PL, async () => {
				await conn.launchRequest(FILE_TEST_PL, DATA_ROOT, []);
				await conn.setBreakPoint(9, FILE_TEST_PL);
				const res = await conn.continue();
				assert.equal(res.ln, 9);
			});

			test('Should throw an error ' + FILE_BROKEN_CODE, async () => {
				await conn.launchRequest(FILE_BROKEN_CODE, DATA_ROOT, []);
				await conn.setBreakPoint(9, FILE_BROKEN_CODE);
				// In between we have broken code
				await conn.setBreakPoint(11, FILE_BROKEN_CODE);

				const res = await conn.continue();
				assert.equal(res.ln, 9);
				// In between we have broken code
				const res_broken = <RequestResponse>await asyncAssert.throws(conn.continue());

				assert.equal(res_broken.finished, true);
				assert.equal(res_broken.errors.length, 1);
			});
		});

		suite('next', () => {
			test('Should go to next statement', async () => {
				let res = await conn.launchRequest(FILE_TEST_PL, DATA_ROOT, []);
				assert.equal(res.ln, 5);
				res = await conn.next();
				assert.equal(res.ln, 6);
			});
		});

		suite('getVariableList', () => {
			test('Should get more scope variables types', async function() {
				await conn.launchRequest(FILE_TEST_PL, DATA_ROOT, []);
				await conn.setBreakPoint(23, FILE_MODULE);

				await conn.continue();
				let vars = await conn.getVariableList(0);

				assert.equal(Object.keys(vars).length, 7);
			});
		});

		suite('restart', () => {
			test('Should start from the beginning', async () => {
				let res = await conn.launchRequest(FILE_TEST_PL, DATA_ROOT, []);
				assert.equal(res.ln, 5);
				res = await conn.next();
				assert.equal(res.ln, 6);
				res = await conn.restart();
				if (/^win/.test(process.platform)) {
					// xxx: On windows we ned to respawn the debugger
					// it might be "inhibit_exit" is not working on windows
					// causing us to workaround...
				} else {
					assert.equal(res.ln, 5);
				}
			});
		});

		suite.skip('resolveFilename', () => {
			test('Should resolve filenames', async () => {
				let res = await conn.launchRequest(FILE_TEST_NESTED_PL, DATA_ROOT, []);
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
