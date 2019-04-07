/// <reference path="../../built/pxtcompiler.d.ts"/>
/// <reference path="../../built/pxtsim.d.ts"/>

import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';

import "mocha";
import * as chai from "chai";

import { TestHost } from "../common/testHost";
import * as util from "../common/testUtils";
import { resolve } from 'url';
import { promisify } from 'util';

// TODO: Split this file up. I (dazuniga) spent ~1hr trying to split this file into two pieces but I cannot figure out 
// how to make that work with the way we're using jake & namespaces / modules

// tests
const casesDir = path.join(process.cwd(), "tests", "trace-tests", "cases");

describe("convert and compare traces between ts<->py ", () => {
    let tsOrPyFiles: string[]
    // before(() => {
    pxsim.initCurrentRuntime = pxsim.initBareRuntime
    cleanup()
    let tsFiles = util.getFilesByExt(casesDir, ".ts")
    let pyFiles = util.getFilesByExt(casesDir, ".py")
    tsOrPyFiles = tsFiles.concat(pyFiles)
    // })

    tsOrPyFiles.forEach(file => {
        it("should preserve semantics when converting between .ts and .py " + path.basename(file), async function () {
            this.timeout(10000)
            await testTsOrPy(file)
            return
        });
    });
});

async function testTsOrPy(tsOrPyFile: string): Promise<void> {
    let ext = path.extname(tsOrPyFile)
    let isPy = ext === ".py"
    let isTs = ext === ".ts"
    if (!isPy && !isTs)
        return Promise.reject("Invald non-.py, non-.ts file: " + tsOrPyFile)

    let baselineFile: string;
    let baseline: string;
    let recordBaseline = (bl: string) => {
        baseline = bl
        baselineFile = tsOrPyFile + ".baseline"
        fs.writeFileSync(baselineFile, baseline)
    }
    if (isPy) {
        let pyFile = tsOrPyFile
        recordBaseline(await PY(pyFile))
        let tsFile = await testPy2Ts(pyFile)
        await testSts(tsFile)
        let pyFile2 = await testTs2Py(tsFile)
    } else {
        let tsFile = tsOrPyFile
        recordBaseline(await TS(tsFile))
        await testSts(tsFile)
        let pyFile = await testTs2Py(tsFile)
        let tsfile2 = await testPy2Ts(pyFile)
        await testSts(tsfile2)
    }

    return;
    async function testConversion(inFile: string, isPy: boolean): Promise<string> {
        let convert = isPy ? PY2TS : TS2PY
        let runConverted = isPy ? TS : PY
        let fnName = isPy ? "py2ts" : "ts2py"
        let errFile = inFile + `.${fnName}_error`;
        return convert(inFile)
            .error(r => {
                fs.writeFileSync(errFile, JSON.stringify(r))
                return `${fnName} failed to convert '${inFile}'. Error saved at:\n${errFile}\nError is:\n${r}`
            })
            .then(async outFile => {
                let outTrace = await runConverted(outFile)
                if (!util.compareBaselines(outTrace, baseline)) {
                    fs.writeFileSync(errFile, outTrace)
                    return Promise.reject(
                        `${fnName} incorrectly converted>\n${inFile}\nto\n:${outFile}\n` +
                        `Trace mismatch with baseline. Baseline:\n${baseline}\nIncorrect trace:\n${outTrace}\n` +
                        `Diff conversion with:\ncode --diff ${inFile} ${outFile}\n` +
                        `Diff traces with:\ncode --diff ${baselineFile} ${errFile}\n`)
                }
                return outFile
            })
    }
    async function testPy2Ts(pyFile: string): Promise<string> {
        return testConversion(pyFile, true)
    }
    async function testTs2Py(tsFile: string): Promise<string> {
        return testConversion(tsFile, false)
    }
    async function testSts(tsFile: string): Promise<void> {
        let errFile = tsFile + ".sts_error"
        return STS(tsFile)
            .error(r => {
                fs.writeFileSync(errFile, JSON.stringify(r))
                return `Static Typescript failed to run on '${tsFile}'. Error saved at:\n${errFile}\nError is:\n${r}`
            })
            .then(outTrace => {
                if (!util.compareBaselines(outTrace, baseline)) {
                    fs.writeFileSync(errFile, outTrace)
                    return Promise.reject(
                        `Static Typescript produced a different trace when run on:\n${tsFile}` +
                        `Baseline:\n${baseline}\nIncorrect trace:\n${outTrace}\n` +
                        `Diff traces with:\ncode --diff ${baselineFile} ${errFile}\n`)
                }
                return outTrace
            })
    }
}

// DSL for the tests
function STS(tsFile: string): Promise</*trace*/string> {
    return compileAndRunStsAsync(tsFile)
}
function TS(tsFile: string): Promise</*trace*/string> {
    return Promise.resolve(compileAndRunTs(tsFile))
}
function PY(pyFile: string): Promise</*trace*/string> {
    return runPyAsync(pyFile)
}
function TS2PY(tsFile: string): Promise</*file*/string> {
    return convertTs2Py(tsFile)
}
function PY2TS(pyFile: string): Promise</*file*/string> {
    return convertPy2Ts(pyFile)
}

// setup
function initGlobals() {
    Promise = require("bluebird");
    let g = global as any
    g.pxt = pxt;
    g.ts = ts;
    g.pxtc = pxtc;
    g.btoa = (str: string) => new Buffer(str, "binary").toString("base64");
    g.atob = (str: string) => new Buffer(str, "base64").toString("binary");
}
initGlobals();

// Just needs to exist
pxt.setAppTarget(util.testAppTarget);

// TODO we need to use CompileHost for compiling STS

function removeBySubstring(dir: string, sub: string) {
    return fs.readdirSync(dir)
        .filter(f => f.indexOf(sub) >= 0)
        .map(f => path.join(dir, f))
        .forEach(f => fs.unlinkSync(f))
}

function cleanup() {
    removeBySubstring(casesDir, ".js")
    removeBySubstring(casesDir, ".py.ts")
    removeBySubstring(casesDir, ".ts.py")
    removeBySubstring(casesDir, ".py2ts_error")
    removeBySubstring(casesDir, ".ts2py_error")
    removeBySubstring(casesDir, ".sts_error")
    removeBySubstring(casesDir, ".baseline")
}

function runPyAsync(pyFile: string): Promise<string> {
    return new Promise((resolve, reject) => {
        exec(`python3 ${pyFile}`, (err, stdout, stderr) => {
            let trace = ""
            if (stdout)
                trace += stdout
            if (stderr)
                trace += stderr
            if (err)
                trace += `${err.name}: ${err.message}\n${err.stack}`
            resolve(trace)
        })
    });
}

async function convertTs2Py(tsFile: string): Promise<string> {
    let pyCode = await util.ts2pyAsync(tsFile)
    const pyFile = path.join(util.replaceFileExtension(tsFile, ".ts.py"));
    fs.writeFileSync(pyFile, pyCode)
    return pyFile
}

async function convertPy2Ts(pyFile: string): Promise<string> {
    let tsCode = await util.py2tsAsync(pyFile)
    const tsFile = path.join(util.replaceFileExtension(pyFile, ".py.ts"));
    fs.writeFileSync(tsFile, tsCode)
    return tsFile
}

function fail(msg: string) {
    chai.assert(false, msg);
}

function emitJsFiles(prog: ts.Program, file?: ts.SourceFile): string[] {
    let jsFiles: string[] = []
    prog.emit(file, (f, data) => {
        fs.writeFileSync(f, data)
        jsFiles.push(f)
    });
    return jsFiles
}

function compileTsToJs(filename: string): ts.Program {
    let cOpts: ts.CompilerOptions = {
        // TODO(dz): check these options
        noEmitOnError: true,
        noImplicitAny: true,
        target: ts.ScriptTarget.ES5,
        module: ts.ModuleKind.ES2015,
        // noLib: true,
        // skipLibCheck: true
    }
    return ts.pxtc.plainTscCompileFiles([filename], cOpts)
}
function evalJs(js: string): string {
    // TODO don't use eval?
    let stout: string[] = []
    let console: any = {}
    console.log = function (str: string) {
        stout.push(str)
        return str
    }
    eval(js)

    return stout.join("\n")
}
function compileAndRunTs(filename: string): string {
    let prog = compileTsToJs(filename)
    let diagnostics = ts.pxtc.getProgramDiagnostics(prog)
    let diagMsgs = diagnostics.map(ts.pxtc.getDiagnosticString)
    if (diagMsgs.length)
        return diagMsgs.join("\n")
    else {
        let fileSrc = prog.getSourceFile(path.basename(filename))
        let jsFiles = emitJsFiles(prog, fileSrc)
        let js = jsFiles
            .map(f => fs.readFileSync(f, { flag: "r" }))
            .map(f => f.toString())
            .join("\n\n")
        let trace = evalJs(js)
        return trace
    }
}

function compileAndRunStsAsync(filename: string): Promise<string> {
    const prelude: string = `
    let console: any = {}
    console.log = function(s: string): void {
        control.__log(s)
        control.__log("\\n")
        control.dmesg(s)
        //serial.writeString(s)
        //serial.writeString("\\n")
        //pause(50);
    }`
    return util.stsAsync(filename, prelude)
        .then((compiled) => {
            return runStsAsync(compiled)
        })
}

function runStsAsync(res: pxtc.CompileResult): Promise<string> {
    return new Promise<string>((resolve, reject) => {
        let f = res.outfiles[pxtc.BINARY_JS]
        if (f) {
            let timeout = setTimeout(() => {
                reject(new Error("Simulating code timed out"))
            }, 5000);
            let r = new pxsim.Runtime({ type: "run", code: f })
            r.errorHandler = (e) => {
                clearTimeout(timeout);
                reject(e);
            }
            let trace = ""
            pxsim.Runtime.messagePosted = (msg) => {
                if (msg.type === "bulkserial") {
                    let smsg = msg as pxsim.SimulatorBulkSerialMessage
                    for (let m of smsg.data)
                        trace += `${m.data}\n`
                }
            }
            r.run(() => {
                clearTimeout(timeout);
                pxsim.dumpLivePointers();
                resolve(trace)
            })
        }
        else {
            reject(new Error("No compiled js"));
        }
    })
}