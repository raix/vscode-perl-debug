import assert = require('assert');
import * as Path from 'path';
import { PerlDebuggerConnection, RequestResponse } from '../adapter';
import { LocalSession } from '../localSession';
import { LaunchRequestArguments } from '../perlDebug';

const PROJECT_ROOT = Path.join(__dirname, '../../');
const DATA_ROOT = Path.join(PROJECT_ROOT, 'src/tests/data/');

const FILE_TEST_PL = 'slow_test.pl';

describe('Perl debugger connection', () => {

	let conn: PerlDebuggerConnection;
	const trackedSessions: LocalSession[] = [];

	beforeEach(async () => {
		conn = new PerlDebuggerConnection();
		await conn.initializeRequest();
	});

	afterEach(async () => {
		await conn.destroy();
		conn = null;

		// Clean up tracked sessions
		while (trackedSessions.length > 0) {
			trackedSessions.pop().kill();
		}
	});

	function setupDebugger(
		conn: PerlDebuggerConnection,
		file: string,
		cwd: string,
		args: string[],
		launchOptions: any = {}
	): Promise<RequestResponse> {

		// Not to conflict with VS Code jest ext
		const port = 5000 + Math.round(Math.random()*100);

		const launchArgs: LaunchRequestArguments = {
			program: FILE_TEST_PL,
			root: DATA_ROOT,
			execArgs: args,
			port: port,
			console: 'remote',
			exec: 'perl',
			env: {
				PATH: process.env.PATH || '',
				PERL5LIB: process.env.PERL5LIB || '',
			},
			...launchOptions
		};

		// Start "remote" debug session
		trackedSessions.push(new LocalSession({
			exec: 'perl',
			execArgs: [],
			program: FILE_TEST_PL,
			root: DATA_ROOT,
			args: launchArgs.args,
			console: 'none',
			env: {
				 // Trigger remote debugger
				PERLDB_OPTS: `RemotePort=localhost:${port}`,
			},
		}));

		// Listen for remote debugger session
		return conn.launchRequest(
			launchArgs,
			null
		);
	}

	it('Should be able to get remote expression values from ' + FILE_TEST_PL, async () => {

		const server = setupDebugger(
			conn, FILE_TEST_PL, DATA_ROOT, [], {
				args: ['foo=bar', 'test=ok'],
			}
		);

		// Wait for result
		const res = await server;

		// Ask Perl for the scripts command line arguments
		const expressionValue = await conn.getExpressionValue('"@ARGV"');

		assert.equal(expressionValue, 'foo=bar test=ok');
		assert.equal(res.finished, false);
		assert.equal(res.exception, false);
		assert.equal(res.ln, 7); // The first code line in test.pl is 7
	});

	it('Should be able to get loaded scripts and their source code from' + FILE_TEST_PL, async () => {

		const server = setupDebugger(
			conn, FILE_TEST_PL, DATA_ROOT, []
		);

		// Wait for result
		const res = await server;

		const loadedFiles = await conn.getLoadedFiles();
		const modulePms = loadedFiles.filter(
			x => x.endsWith('Module.pm')
		);

		assert.ok(
			modulePms.length > 0,
			'Must have loaded a `Module.pm` file'
		);

		const sourceCode = await conn.getSourceCode(modulePms[0]);

		assert.ok(
			sourceCode.indexOf('Hello module') > 0,
			'Module.pm source code contains "Hello module"'
		);
	});
});
