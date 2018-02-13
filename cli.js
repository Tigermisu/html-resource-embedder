#!/usr/bin/env node
'use strict';
const fs = require('fs')
const path = require('path');
const meow = require('meow');
const chalk = require('chalk');
const domutils = require('domutils');
const b64img = require('base64-img');
const htmlparser = require("htmlparser2");
const Spinner = require('cli-spinner').Spinner;
const cli = meow(`
    Usage
      $ html-embed <options>

    Options
      --source,   -s  Specify source directory (defaults to src/)
      --output,   -o  Specify output directory (defaults to dist/)
      --images,   -i  Convert images to base64 and embed them
      --external, -e  Fetch external resources and embed them
      --minify,   -m  Minify resources and html
      --all,      -a  Shorthand for -iem
      --verbose,  -v  Output all operations

    Examples
      $ html-embed -source html/ -output compiled/ -i
      $ html-embed -a
      $ html-embed -s ./ -im
`, {
	flags: {
        source: {
            type: 'string',
            alias: 's',
            default: 'src/',
        },

        output: {
            type: 'string',
            alias: 'o',
            default: 'dist/',
        },

        images: {
            type: 'boolean',
            alias: 'i',
            default: false,
        },

        external: {
            type: 'boolean',
            alias: 'e',
            default: false,
        },

        minify: {
            type: 'boolean',
            alias: 'm',
            default: false,
        },

        all: {
            type: 'boolean',
            alias: 'a',
            default: false,
        },

        verbose: {
            type: 'boolean',
            alias: 'v',
            default: false,
        }
	}
});

const basePath = path.normalize(path.join(__dirname, cli.flags.source));
const baseOutputPath = path.normalize(path.join(__dirname, cli.flags.output));

let numberOfFilesToProcess = 0;
let numberOfFilesProcessed = 0; // To track when we're done.
let spinner = new Spinner('processing');

spinner.setSpinnerString(3);
spinner.start();

const assertError = (err, msg) => {
    if(err) {
        console.log(chalk.red(`Error: ${msg}`));
        process.exit(1);
    }
}

const verboseLog = (msg) => {
    if(cli.flags.verbose) {
        console.log(msg);
    }
}

const writeFile = (dom, filePath) => {
    let domStr = '';

    dom.forEach((elem) => {
        domStr += domutils.getOuterHTML(elem);
    });

    verboseLog(`Writing embedded file ${chalk.blue(filePath)}`);
    fs.writeFile(filePath, domStr, (err) => {
        assertError(err, `Failed to write file ${filePath} - ${err}`);
        verboseLog(chalk.green('Success!'));

        if(++numberOfFilesProcessed == numberOfFilesToProcess) {
            console.log(chalk.green('Done :)'));
            spinner.stop(true); // This will end the script execution if nothing else is queued.
        } else {
            Spinner.setSpinnerTitle(`processed ${numberOfFilesProcessed} out of ${numberOfFilesToProcess}`)
        }
    });
}

const fetchAndEmbedResource = (tag, requiredAttributes, type, pathAttribute, newTagType, newTagName) => {
    let shouldProcess = typeof(tag.attribs) !== "undefined";

    requiredAttributes.forEach(attribute => shouldProcess = shouldProcess && tag.attribs[attribute]);

    if(shouldProcess) {
        let src = tag.attribs[pathAttribute],
            isExternal = src.startsWith('http');

        if(!isExternal) {
            let filePath = path.join(basePath, src);

            verboseLog(`Fetching ${type} ${chalk.blue(src)}`);

            if(!fs.existsSync(filePath)) {
                console.log(chalk.red(`Unable to fetch ${type} ${src}`));
            } else {
                if(type != 'image') {
                    let data = fs.readFileSync(filePath, 'utf8');

                    delete tag.attribs.src;

                    if(type == 'stylesheet') {
                        const regex = /url\((?:"|')?(.*?\.(?:jpg|gif|png|jpeg|exif|bmp|tiff|ppm|pgm|pbm|pnm|svg))(?:"|')?\)/gi;
                        const baseResourceUrl = path.dirname(filePath);
                        data = data.replace(regex, (match, p1) => {
                            const p = path.join(baseResourceUrl, p1);
                            verboseLog(`Fetching image for css resource ${chalk.blue(p)}`);
                            return `url(${b64img.base64Sync(p)})`;
                        }); // Embed image URLs

                        delete tag.attribs;
                    }

                    if(newTagType) {
                        tag.type = newTagType;
                    }

                    if(newTagName) {
                        tag.name = newTagName;
                    }

                    tag.children = [{
                        data: data,
                        type: 'text'
                    }];
                } else {
                    tag.attribs.src = b64img.base64Sync(filePath);
                }
            }
        } else if (cli.flags.external) {
            verboseLog(`Fetching ${type}  ${chalk.blue(src)}`);
            assertError(true, 'Resolving external files is not supported yet.');
        }
    }
}

const embedResources = (dom, filePath) => {
    verboseLog('Embedding resources...');
    let scriptTags = domutils.findAll((elem) => elem.type == 'script', dom),
        linkTags = domutils.findAll((elem) => elem.name == 'link', dom),
        imageTags = [];

    if(cli.flags.images) {
        imageTags = domutils.findAll((elem) => elem.name == 'img', dom);
    }

    scriptTags.forEach((tag) => {
        fetchAndEmbedResource(tag, ['src'], 'script', 'src');
    });

    linkTags.forEach((tag) => {
        fetchAndEmbedResource(tag, ['rel', 'href'], 'stylesheet', 'href', 'style', 'style');
    });

    imageTags.forEach((tag) => {
        fetchAndEmbedResource(tag, ['src'], 'image', 'src');
    });

    writeFile(dom, filePath);
}

const parseHtmlFiles = (htmlFiles) => {

    htmlFiles.forEach((file) => {
        let filePath = path.join(basePath, file);

        verboseLog(`Opening file ${chalk.blue(filePath)}`);

        fs.readFile(filePath, (err, data) => {
            assertError(err, `Unable to read file ${filePath}`);
            verboseLog('Parsing file...');


            let handler = new htmlparser.DomHandler((err, dom) => {
                    assertError(err, 'Error parsing file.');
                    embedResources(dom, path.join(baseOutputPath, file));
                }, {normalizeWhitespace: cli.flags.minify});

            let parser = new htmlparser.Parser(handler);

            parser.write(data);

            parser.end();
        });
    });
}

// If the -all flag is set, activate the other ones.
if(cli.flags.all) {
    cli.flags.minify = true;
    cli.flags.images = true;
    cli.flags.external = true;
}

// Get all HTML files in the source directory, starting the process
fs.readdir(cli.flags.source, (err, data) => {
    assertError(err, `Source directory not found (${basePath})`);

    // Verify output directory exists, create it if not.
    if(!fs.existsSync(baseOutputPath)) {
        fs.mkdir(baseOutputPath, err => assertError(err, `Failed to create directory ${baseOutputPath} - ${err}`));
    }

    let htmlFiles = [];

    data.forEach((file) => {
        if(file.split('.').pop().toLowerCase() == 'html') {
            htmlFiles.push(file);
        }
    });

    numberOfFilesToProcess = htmlFiles.length;

    if(numberOfFilesToProcess > 0) {
        console.log(`Processing ${numberOfFilesToProcess} html file${numberOfFilesToProcess > 1? 's':''} in directory ${chalk.blue(basePath)}`);
        parseHtmlFiles(htmlFiles);
    } else {
        spinner.stop();
        console.log(chalk.yellow(`Did not find any .html files in directory ${chalk.blue(basePath)}`));
    }
});