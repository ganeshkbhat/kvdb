
const fs = require('fs');
const url = require('url');
const http = require('http');
const https = require('https');
const WebSocket = require('ws');
const readline = require('readline');
const express = require('express');
const path = require("path");
const JsonManager = require("json-faster").JsonManager;
const shellflags = require("shellflags");

// init shell line 
//  > capture auth and db values 
//  > run the db server
//  > run the shell commandline

// const manager = new JsonManager()

function shellParser(results = {}) {
    const prefixDefinitions = [
        // -t: type : http, https, ws, wss
        { prefix: "-t", handler: () => console.log },
        // -p : port : 3443, 8080, 80, 443
        { prefix: "-p", handler: (v) => Number(v) },
        // -ip : ip : ip address, url, domain name
        { prefix: "-ip", handler: () => console.log },
        // -k : key : certificate key
        { prefix: "-k", handler: () => console.log },
        // -c : cert : certificate
        { prefix: "-c", handler: () => console.log },
        // -m : mode : db, shell
        { prefix: "-m", handler: () => console.log },
        // -u : username : username for authentication
        { prefix: "-u", handler: () => console.log },
        // -pwd : password : password for authentication
        { prefix: "-pwd", handler: () => console.log },
        // -s : mode : mode of operation : shell, db
        { prefix: "-s", handler: () => console.log },
        // -dt : load data for data : 
        //      these are -dt load db data not shell args/data
        { prefix: "-dt", handler: () => console.log },
        // // -j : json config file : password for authentication
        // { prefix: "-j", handler: () => console.log }
    ];

    var results = shellflags(prefixDefinitions);
    console.log("results of shell command without default values : ", JSON.stringify(results));

    // type, port, ip/url, key, certificate, server, mode
    var middlewares = [];
    var app = (req, res, next) => { next() };

    //
    // // -j : "path to entire js file object"
    // // considering
    // // if all are not defined then parse json file for json object
    // // if j is provided then no other values of shell will be parsed ignoring even default assignments
    // if (!!results["-j"]) {
    //     try {
    //         let filepath = fs.readFileSync(path.join(process.cwd(), results["-j"]), "utf8")
    //         results = { ...results, ...JSON.parse(JSON.stringify(require(filepath))) }
    //         return results
    //     } catch (e) {
    //         results = { ...results, ...JSON.parse(JSON.stringify(require(path.join(process.cwd(), results["-j"])))) }
    //         return results
    //     }
    // }


    // parsing shell and their values 
    //      and applying defaults if some important keys are missing
    var type = results["-t"] = results["-t"] || "http";
    var port = results["-p"] = Number(results["-p"]) || 3443;
    var ip = results["-ip"] = results["-ip"] || "127.0.0.1";
    var key = results["-k"] = results["-k"] || null;
    var cert = results["-c"] = results["-c"] || null;
    var username = results["-u"] = results["-u"] || null;
    var password = results["-pwd"] = results["-pwd"] || null;
    var dataLoad = results["-dt"] = results["-dt"] || "{}";
    var mode = results["-s"] = results["-s"] || "shell";

    console.log("results of shell command : ", JSON.stringify(results));
    return results
}

// shellParser()
// 
// results (of shell parsing) will be used to start the shell.js and/or server.js 
module.exports = shellParser;

