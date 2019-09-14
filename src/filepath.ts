import { resolve } from "path";
export const convertToPerlPath = (filePath: string, rootPath?: string) =>
	(rootPath != null ? resolve(rootPath || "", filePath) : filePath)
		.replace(/\\{1,2}/g, "/")
		.replace(/^\.\.\/+/g, '');
