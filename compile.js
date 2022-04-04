'use strict';

const fs = require('fs');

let rawdata = fs.readFileSync('ls.json');
let listing = JSON.parse(rawdata);
let mapping = {};
for (let i = 0; i < listing.length; i++) {
	mapping[listing[i].packid] = listing[i];
}
let requestedPackages = ['*'];
const gitimportFilename = "gitimport.bat";
const packageGitignore = "../.gitignore";
const nonstandardManifest = "../nonstandardmanifest.json";
let extraLibGitignore = "";
let gitimport = "cd ..\n";
let libgitignore = null;

DoThese([
	prepareNonStandardManifest,
	prepareToAddToGitignore,
	writePackageJsonFiles,
	determineWhichPackagesToImportFromGit,
	writeGitimportBatchfile,
	writeGitignore,
	function(callback) { console.log(_colorCyan("finished package metadata compile")); callback(null); }
]);

function DoThese(thingsToDo) {
	function DoThem(err) {
		if (!err) {
			if (thingsToDo.length == 0) { return; }
			let nextThing = thingsToDo[0];
			thingsToDo = thingsToDo.slice(1);
			//console.log(`about to do thing ${thingsToDoIndex}: ${thingsToDo[thingsToDoIndex]}`);
			nextThing(DoThem);
		} else {
			throw err;
		}
	}
	DoThem();
}

function prepareNonStandardManifest(callback) {
	fs.readFile(nonstandardManifest, 'utf8' , (err, data) => {
		if (err) {
			requestAllPackages();
			writeNonStandardManifest(callback);
			return;
		}
		let packageManifest = JSON.parse(data);
		requestedPackages = packageManifest.req;//data.split('\n');
		console.log(`${_colorCyan("need packages: ")} ${requestedPackages.join(", ")}`);
		callback();
	});
}

function requestAllPackages() {
	requestedPackages = [];
	for (let i = 0; i < listing.length; ++i) {
		let packid = listing[i].packid;
		if (!packid) {
			console.log(_colorRed(`missing package id for ${listing[i]}`));
		}
		requestedPackages.push(packid);
	}
}

function writeNonStandardManifest(callback) {
	let reqs = requestedPackages.length > 0 ? 
		'\n\t\t"' + requestedPackages.join('",\n\t\t"') + '"\n\t' : "";
	let nonstandardManifestText =
`{
	"req": [${reqs}]
}`;
	fs.writeFile(nonstandardManifest, nonstandardManifestText, err => {
		if (err) { console.error(err); return; }
		callback();
	});
}

function prepareToAddToGitignore(callback) {
	fs.readFile(packageGitignore, 'utf8' , (err, data) => {
		if (err) {
			console.error(err);
			callback();
			return;
		}
		libgitignore = data.split('\n');
		for(let i = 0; i < libgitignore.length; i++) {
			libgitignore[i] = libgitignore[i].replace(/\r/g, "");
		}
		console.log(`${_colorCyan("found")} ${packageGitignore}`);
		callback();
	});
}
function _colorCyan(str) { return `\x1b[36m${str}\x1b[0m`; }
function _colorGreen(str) { return `\x1b[32m${str}\x1b[0m`; }
function _colorRed(str) { return `\x1b[31m${str}\x1b[0m`; }
function writePackageJsonFiles(callback) {
	let written = 0, toWrite = 0;
	let writtenFolders = [];
	for (let i = 0; i < listing.length; ++i) {
		let value = listing[i];
		let key = value.packid;
		if (value.listed === false) { continue; }
		//console.log(`${key}: ${value}`);
		let folderName = getFolderName(value);
		let packageFolder = `../${folderName}`
		let packagePath = packageFolder + '/package.json';
		let packageText = CreatePackageFileData(value,mapping);
		let extraIgnoreEntry = `${folderName}/`;
		if (libgitignore == null || libgitignore.indexOf(extraIgnoreEntry) < 0) {
			console.log(".gitignore does not contain "+extraIgnoreEntry);
			extraLibGitignore += extraIgnoreEntry + "\n";
		}
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

function determineWhichPackagesToImportFromGit(callback) {
	function getDependencies(pack) {
		let deps = [];
		for (let j = 0; j < pack.req.length; ++j) {
			let depId = pack.req[j];
			let dep = mapping[depId];
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
		for (let i = 0; i < requestedPackages.length; ++i) {
			let packid = requestedPackages[i];
			let pack = mapping[packid];
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
				let dependencyIndex = requestedPackages.indexOf(deps[j]);
				if (dependencyIndex >= 0) {
					// if it's after this expected package in the requestedPackages listing
					if (dependencyIndex >= i) {
						// move it to before, and restart this whole process.
						requestedPackages.splice(dependencyIndex, 1);
						requestedPackages.splice(i, 0, deps[j]);
						return true;
					}
				}
				// if the dependency is not in the list
				else {
					// insert it to just before this package entry, and restart this whole process
					requestedPackages.splice(i, 0, deps[j]);
					return true;
				}
			}
		}
		return false;
	}

	// filter out duplicates
	requestedPackages = requestedPackages.filter((x, i) => i === requestedPackages.indexOf(x))
	do{
		//console.log(_colorCyan(requestedPackages.join(":")));
	} while(sortPackagesInsertingDependenciesFirst());

	for (let i = 0; i < requestedPackages.length; i++) {
		let value = mapping[requestedPackages[i]];
		if (value.url) {
			gitimport += `call git clone ${value.url}\n`;
		}
	}
	callback();
}

function writeGitimportBatchfile(callback) {
	fs.writeFile(gitimportFilename, gitimport, err => {
		if (err) { console.error(err); reject(err); return; }
		console.log(`${_colorCyan("wrote")} ${gitimportFilename}`);
		callback();
	});
}

function writeGitignore(callback) {
	if (extraLibGitignore.length > 0) {
		console.log(`adding .gitignore entries:\n${extraLibGitignore}`);
		let finalAddendum = `# NonStandard library\n${extraLibGitignore}`;
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

// line escape converter, so strings can be passed into other string input
function lnesc(text) { return text.replace(/\n/g, "\\n").replace(/\"/g, "\\\"").replace(/\'/g, "\\\'").replace(/\t/g, "\\t"); }

function getFolderName(packageData) { 
	if (!packageData || !packageData.url) { return null; }
	let fullname = packageData.url;
	let indexSlash = fullname.lastIndexOf("/");
	let indexDot = fullname.lastIndexOf(".git");
	return fullname.substring(indexSlash+1, indexDot);
}

function CreatePackageFileData(packageData, mapping) {
	const infoHeader = "NonStandard library imported using NonStandard package management";
	let name = packageData.name;
	let id = packageData.id;
	let desc = packageData.desc ? infoHeader + "\n\n" + packageData.desc : infoHeader;
	let dependencies = [];
	if (packageData.req) {
		for (const [key,value] of Object.entries(packageData.req)) {
			let dep = mapping[value];
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
