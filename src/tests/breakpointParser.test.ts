import { breakpointParser } from "../breakpointParser";

const windowsBreakpointLines =
	`C:/Users/Morten/dev/vscode-perl-debug/src/tests/data/Module.pm:
 4:         my $bar = "bar";
	break if (1)
 5:         my $i = 12;
	break if (1)
C:/Users/Morten space/dev/vscode-perl-debug/src/tests/data/Module.pm:
 40:         my $bar = "bar";
	break if (1)
 50:         my $i = 12;
	break if (1)
slow_test.pl:
 7:     print "Testing\n";
	break if (1)
 10:    for my $i (0..5) {
	break if (1)
 11:        print "pre test..\n";
	break if (1)
 12:        Module::test();
	break if (1)
 13:        sleep(0.01);
	break if (1)
  DB<10>`.split("\n");

describe("breakpointParser", () => {
	it("should parse output on windows", () => {
		expect(breakpointParser(windowsBreakpointLines)).toEqual({
			"C:/Users/Morten/dev/vscode-perl-debug/src/tests/data/Module.pm": [
				4,
				5
			],
			"C:/Users/Morten space/dev/vscode-perl-debug/src/tests/data/Module.pm": [
				40,
				50
			],
			"slow_test.pl": [
				7,
				10,
				11,
				12,
				13
			]
		});
	});
});
