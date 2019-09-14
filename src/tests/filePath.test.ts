import { convertToPerlPath } from "../filepath";
import { platform } from "os";

describe("convertToPerlPath", () => {
	it("should convert windows single slash path to unix", () => {
		expect(convertToPerlPath("C:\\foo\\bar.pl")).toBe("C:/foo/bar.pl");
	});
	it("should convert windows double slash path to unix", () => {
		expect(convertToPerlPath("C:\\\\foo\\\\bar.pl")).toBe("C:/foo/bar.pl");
	});
	it("should convert unix slash path to unix", () => {
		expect(convertToPerlPath("/foo/bar.pl")).toBe("/foo/bar.pl");
	});
	it("should strip the relative part on single slash windows", () => {
		expect(convertToPerlPath("..\\foo\\bar.pl")).toBe("foo/bar.pl");
	});
	it("should strip the relative part on double slash windows", () => {
		expect(convertToPerlPath("..\\\\foo\\\\bar.pl")).toBe("foo/bar.pl");
	});
	it("should strip the relative part on unix", () => {
		expect(convertToPerlPath("../foo/bar.pl")).toBe("foo/bar.pl");
	});
	it("should resolve to root path if supplied", () => {
		if (platform() === "win32") {
			expect(convertToPerlPath("../foo/bar.pl", "C:/root/path")).toBe("C:/root/foo/bar.pl");
		} else {
			expect(convertToPerlPath("../foo/bar.pl", "/root/path")).toBe("/root/foo/bar.pl");
		}
	});
	it("should resolve to path if absolute path was supplied", () => {
		if (platform() === "win32") {
			expect(convertToPerlPath("C:/foo/bar.pl", "C:/root/path")).toBe("C:/foo/bar.pl");
		} else {
			expect(convertToPerlPath("/foo/bar.pl", "/root/path")).toBe("/foo/bar.pl");
		}
	});
});