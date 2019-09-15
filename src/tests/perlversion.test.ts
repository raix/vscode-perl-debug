import { PerlVersion } from "../perlversion";

describe("PerlVersion", () => {
	it("should return correct version", () => {
		const version = new PerlVersion("5.018002");
		expect(version.version).toBe("5.018002");
	});
	it("should return correct major version", () => {
		const version = new PerlVersion("5.018002");
		expect(version.major).toBe(5);
	});
	it("should return correct minor version", () => {
		const version = new PerlVersion("5.018002");
		expect(version.minor).toBe(18);
	});
	it("should return correct patch version", () => {
		const version = new PerlVersion("5.018002");
		expect(version.patch).toBe(2);
	});
	it("should return correct majorMinor version", () => {
		const version = new PerlVersion("5.018002");
		expect(version.majorMinor).toBe("5.18");
	});
	it("should return correct semver version", () => {
		const version = new PerlVersion("5.018002");
		expect(version.semver).toBe("5.18.2");
	});
});
