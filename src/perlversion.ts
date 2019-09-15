export class PerlVersion {
	public version: string;
	public major: number;
	public minor: number;
	public patch: number;
	public semver: string;
	public majorMinor: string;
	constructor(version: string) {
		this.version = version;
		const [major, rest] = version.split('.');
		const minor = rest.substring(0, 3);
		const patch = rest.substring(3);
		this.major = parseInt(major, 10);
		this.minor = parseInt(minor, 10);
		this.patch = parseInt(patch, 10);
		this.majorMinor = `${this.major}.${this.minor}`;
		this.semver = `${this.majorMinor}.${this.patch}`;
	}
}
