// code by michael vaganov, released to the public domain via the unlicense (https://unlicense.org/)
'use strict';
const fs = require('fs');

/** list of all packages in ths system */
let g_packageListing = [];
/** all packages in ths system by id */
let g_packageMapping = {};
/** list of packages the client app wants */
let g_requestedPackages = ['*'];

const gitImportBatchFilename = "gitimport.bat";
const packageGitignore = "../.gitignore";
const nonstandardManifest = "../nonstandardmanifest.json";

/** 
* handy dandy linear promise helper function.
* @param {function(callback)[]} thingsToDoInOrder functions with a single callback to do, in order
*/
function DoThese(thingsToDoInOrder) {
	function DoThem(err) {
		if (err) { throw err; }
		if (thingsToDoInOrder.length == 0) {
			let caller = (new Error()).stack.split("\n")[2].trim();
			console.log(_colorRed(`too many callbacks! Could be ${caller}`));
			return;
		}
		let thingToDoNow = thingsToDoInOrder[0];
		thingsToDoInOrder = thingsToDoInOrder.slice(1);
		thingToDoNow(DoThem);
	}
	DoThem();
}

let _doAll = [
	loadPackageListing,
	loadRequestedPackages,
	writePackageJsonFiles,
	determineWhichPackagesToGitimport,
	writeGitimportBatchfile,
	writeGitignore
];
let _doPackageUpdate = [
	loadPackageListing,
	writePackageJsonFiles,
];
let _doGenerateGitimportFiles = [
	loadPackageListing,
	loadRequestedPackages,
	determineWhichPackagesToGitimport,
	writeGitimportBatchfile,
	writeGitignore
];

var instructionsFromArgs = {
	'all': _doAll,
	'a': _doAll,
	'package': _doPackageUpdate,
	'p': _doPackageUpdate,
	'import': _doGenerateGitimportFiles,
	'i':_doGenerateGitimportFiles
}

let commandLineArgs = process.argv.slice(2);
//console.log('arguments: ', commandLineArgs);
if (commandLineArgs.length > 0) {
	DoTheArgs(commandLineArgs);
} else {
	console.log(_colorRed(`missing argument, valid tokens: [${showValidCommands()}]`));
}

function showValidCommands() { return Object.keys(instructionsFromArgs).join(', '); }

function DoTheArgs(args) {
	function DoNextArgInstructionList(err) {
		if (err) { throw err; }
		if (!args || args.length == 0) { return; }
		let arg = args[0];
		args = args.slice(1);
		let instructions = instructionsFromArgs[arg];
		if (!instructions) {
			console.log(_colorRed(`'${arg}' unknown token, valid tokens: [${showValidCommands()}]`));
			return;
		}
		instructions = instructions.splice(0);
		instructions.push(() => DoNextArgInstructionList());
		DoThese(instructions);
	}
	DoNextArgInstructionList();
}

function loadPackageListing(callback) {
	let rawdata = fs.readFileSync('ls.json');
	g_packageListing = JSON.parse(rawdata);
	for (let i = 0; i < g_packageListing.length; i++) {
		g_packageMapping[g_packageListing[i].packid] = g_packageListing[i];
	}
	callback();
}

function loadRequestedPackages(callback) {
	fs.readFile(nonstandardManifest, 'utf8' , (err, data) => {
		if (err) {
			requestAllPackages();
			writeNonStandardManifest(callback);
			return;
		}
		let packageManifest = JSON.parse(data);
		g_requestedPackages = packageManifest.req;
		console.log(`${_colorCyan("need packages: ")} ${g_requestedPackages.join(", ")}`);
		callback();
	});
}

function requestAllPackages() {
	g_requestedPackages = [];
	for (let i = 0; i < g_packageListing.length; ++i) {
		let packid = g_packageListing[i].packid;
		if (!packid) {
			console.log(_colorRed(`missing package id for ${g_packageListing[i]}`));
		}
		g_requestedPackages.push(packid);
	}
}

function writeNonStandardManifest(callback) {
	let reqs = g_requestedPackages.length > 0 ? 
		'\n\t\t"' + g_requestedPackages.join('",\n\t\t"') + '"\n\t' : "";
	let nonstandardManifestText =
`{
	"req": [${reqs}]
}`;
	fs.writeFile(nonstandardManifest, nonstandardManifestText, err => {
		if (err) { console.error(err); return; }
		callback();
	});
}

function _colorCyan(str) { return `\x1b[36m${str}\x1b[0m`; }
function _colorGreen(str) { return `\x1b[32m${str}\x1b[0m`; }
function _colorRed(str) { return `\x1b[31m${str}\x1b[0m`; }
function writePackageJsonFiles(callback) {
	let written = 0, toWrite = 0;
	let writtenFolders = [];
	for (let i = 0; i < g_packageListing.length; ++i) {
		let value = g_packageListing[i];
		if (value.listed === false) { continue; }
		//console.log(`${key}: ${value}`);
		let folderName = getFolderName(value);
		let packageFolder = `../${folderName}`
		let packagePath = packageFolder + '/package.json';
		let packageText = CreatePackageFileData(value);
		++toWrite;
		writtenFolders.push(folderName);
		fs.writeFile(packagePath, packageText, err => {
			++written;
			if (err) { console.error(err); return; }
			if (written == toWrite){
				console.log(`${_colorCyan("wrote packages")} ${writtenFolders.join(", ")}`);
				callback();
			}
		});
	}
}

function determineWhichPackagesToGitimport(callback) {
	function getDependencies(pack) {
		let deps = [];
		for (let j = 0; j < pack.req.length; ++j) {
			let depId = pack.req[j];
			let dep = g_packageMapping[depId];
			if (!dep) {
				console.log(`missing entry for dependency ${depId}`);
				continue;
			}
			deps.push(depId);
		}
		return deps;
	}
	/// Returns true if this method needs to be run again, because it added to the list
	function sortPackagesInsertingDependenciesFirst() {
		// go through each expected package
		for (let i = 0; i < g_requestedPackages.length; ++i) {
			let packid = g_requestedPackages[i];
			let pack = g_packageMapping[packid];
			if (!pack) {
				console.log(_colorRed(`missing package with id ${packid}`));
				continue;
			}
			if (!pack.req) { continue; }
			// get that package's dependencies.
			let deps = getDependencies(pack);
			// for each dependency
			for (let j = 0; j < deps.length; ++j) {
				// if the dependency is in the list
				let dependencyIndex = g_requestedPackages.indexOf(deps[j]);
				if (dependencyIndex >= 0) {
					// if it's after this expected package in the g_requestedPackages listing
					if (dependencyIndex >= i) {
						// move it to before, and restart this whole process.
						g_requestedPackages.splice(dependencyIndex, 1);
						g_requestedPackages.splice(i, 0, deps[j]);
						return true;
					}
				}
				// if the dependency is not in the list
				else {
					// insert it to just before this package entry, and restart this whole process
					g_requestedPackages.splice(i, 0, deps[j]);
					return true;
				}
			}
		}
		return false;
	}

	// filter out duplicates
	g_requestedPackages = g_requestedPackages.filter((x, i) => i === g_requestedPackages.indexOf(x))
	do{
		//console.log(_colorCyan(g_requestedPackages.join(":")));
	} while(sortPackagesInsertingDependenciesFirst());

	callback();
}

function writeGitimportBatchfile(callback) {
	let gitImportBatchFile = "cd ..\n";
	for (let i = 0; i < g_requestedPackages.length; i++) {
		let value = g_packageMapping[g_requestedPackages[i]];
		if (value.url) {
			gitImportBatchFile += `call git clone ${value.url}\n`;
		}
	}
	fs.writeFile(gitImportBatchFilename, gitImportBatchFile, err => {
		if (err) { console.error(err); reject(err); return; }
		console.log(`${_colorCyan("wrote")} ${gitImportBatchFilename}`);
		callback();
	});
}

/// adds `g_requestedPackages` to .gitignore
function writeGitignore(callback) {
	let gitignoreList = null;
	let foldersToIgnore = [];
	DoThese([
		listFoldersToIgnore,
		loadGitignoreList,
		writeMissingFoldersToGitignoreFile,
		c => callback()
	]);
	function listFoldersToIgnore(callback) { 
		for(let i = 0; i < g_requestedPackages.length; ++i) {
			let packageData = g_packageMapping[g_requestedPackages[i]];
			if (!packageData) { continue; }
			let folderName = getFolderName(packageData);
			if (!folderName) { continue; }
			foldersToIgnore.push(`${folderName}/`);
		}
		callback();
	}
	function loadGitignoreList(callback) {
		fs.readFile(packageGitignore, 'utf8' , (err, data) => {
			if (err) {
				console.error(err);
				callback();
				return;
			}
			gitignoreList = data.split('\n');
			for(let i = 0; i < gitignoreList.length; i++) {
				gitignoreList[i] = gitignoreList[i].replace(/\r/g, "");
			}
			console.log(`${_colorCyan("found")} ${packageGitignore}`);
			callback();
		});
	}
	function writeMissingFoldersToGitignoreFile(callback) {
		let gitignoresToAdd = WhatIsMissing(gitignoreList, foldersToIgnore);
		if (gitignoresToAdd.length > 0) {
			console.log(`adding .gitignore entries:\n${gitignoresToAdd}`);
			let finalAddendum = `# NonStandard library\n${gitignoresToAdd.join('\n')}\n`;
			fs.appendFile(packageGitignore, finalAddendum, function (err) {
				if (err) { callback(err); throw err; }
				console.log(`${_colorCyan("updated")} ${packageGitignore}`);
				callback();
			});
		} else {
			console.log(_colorGreen(`${packageGitignore} already up to date`));
			callback();
		}
	}
}

function WhatIsMissing(whatIsAlreadyThere, whatShouldbeAdded) {
	let whatIsMissing = [];
	for (let i = 0; i < whatShouldbeAdded.length; ++i) {
		let entry = whatShouldbeAdded[i];
		if (whatIsAlreadyThere == null || whatIsAlreadyThere.indexOf(entry) < 0) {
			whatIsMissing.push(extraIgnoreEntry);
		}
	}
	return whatIsMissing;
}

// line escape converter, so strings can be passed into other string input
function lnesc(text) { return text.replace(/\n/g, "\\n").replace(/\"/g, "\\\"").replace(/\'/g, "\\\'").replace(/\t/g, "\\t"); }

function getFolderName(packageData) { 
	if (!packageData || !packageData.url) { return null; }
	let fullname = packageData.url;
	let indexSlash = fullname.lastIndexOf("/");
	let indexDot = fullname.lastIndexOf(".git");
	return fullname.substring(indexSlash+1, indexDot);
}

function CreatePackageFileData(packageData) {
	const infoHeader = "NonStandard library imported using NonStandard package management";
	let name = packageData.name;
	let id = packageData.id;
	let desc = packageData.desc ? infoHeader + "\n\n" + packageData.desc : infoHeader;
	let dependencies = [];
	if (packageData.req) {
		for (const [key,value] of Object.entries(packageData.req)) {
			let dep = g_packageMapping[value];
			if (!dep) {
				console.log(`missing dependency '${value}'`);
				continue;
			}
			dependencies.push(dep);
		}
	}
	let dependenciesVersionString = (dependencies.length > 0 ? "{\n" : "{}");
	dependencies.forEach((d, i) => {
		dependenciesVersionString += `\t\t\"${d.id}\": \"${d.v}\"`;
		if (i < dependencies.length-1) {
			dependenciesVersionString += '",\n';
		} else {
			dependenciesVersionString += '"\n\t}';
		}
	});
	let author = "Michael Vaganov";
	let email = "mvaganov@gmail.com";
	let authorurl = "https://github.com/mvaganov/NonStandard";
	let version = packageData.v ? packageData.v : "1.0.0";
	let keywords = packageData.keywords ? packageData.keywords : ["library", "NonStandard"];
	let keywordsString = `[\n		"${keywords.join('",\n		"')}"\n	]`;
	var packageTemplate =
`{
	"@comment package": ["autogenerated by the compile.js script in NonStandard"],
	"name": "${id}",
	"version": "${version}",
	"displayName": "${name}",
	"description": "${lnesc(desc)}.",
	"unity": "2019.4",
	"dependencies": ${dependenciesVersionString},
	"keywords": ${keywordsString},
	"author": {
		"name": "${author}",
		"email": "${email}",
		"url": "${authorurl}"
	},
	"type": "library"
}`;
	return packageTemplate;
}
