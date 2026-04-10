import http from "k6/http"
import type {Options} from "k6/options"

export const options: Options = {
  vus: 10,
  scenarios: {
    nothing_tiny: {
      duration: "10s",
      executor: "constant-vus",
      exec: "nothing_tiny"
    }, nothing_medium: {
      duration: "10s",
      executor: "constant-vus",
      exec: "nothing_medium",
      startTime: "10s"
    }, nothing_large: {
      duration: "10s",
      executor: "constant-vus",
      exec: "nothing_large",
      startTime: "20s"
    }, detach_tiny: {
      duration: "10s",
      executor: "constant-vus",
      exec: "detach_tiny",
      startTime: "30s"
    }, detach_medium: {
      duration: "10s",
      executor: "constant-vus",
      exec: "detach_medium",
      startTime: "40s"
    },
    detach_large: {
      duration: "10s",
      executor: "constant-vus",
      exec: "detach_large",
      startTime: "50s"
    },
  },
  thresholds: {
    'http_req_duration{scenario:nothing_tiny}': ['avg<0.2'],
    'http_req_duration{scenario:detach_tiny}': ['avg<0.2'],

    'http_req_duration{scenario:nothing_medium}': ['avg<1'],
    'http_req_duration{scenario:detach_medium}': ['avg<0.7'],

    'http_req_duration{scenario:nothing_large}': ['avg<9'],
    'http_req_duration{scenario:detach_large}': ['avg<5'],
    
    // nothing_* tests have much wider range because of GC's unpredictability
    
    'http_reqs{scenario:nothing_tiny}': ['count>50000'],
    'http_reqs{scenario:detach_tiny}': ['count>50000'],

    'http_reqs{scenario:nothing_medium}': ['count>10000'],
    'http_reqs{scenario:detach_medium}': ['count>14000'],

    'http_reqs{scenario:nothing_large}': ['count>1050', 'count<2300'],
    'http_reqs{scenario:detach_large}': ['count>1950'],
  }
}
// it is expected to hit node:buffer pool, but it DOESN'T, which is great for "detach" 
var tinyBody= new ArrayBuffer(1)
// is maximum in practise, but on localhost might arrive in 2 chunks, so not descriptive enough
var mediumBody= new ArrayBuffer(1024*1024)
var largeBody = new ArrayBuffer(10 * 1024 * 1024);

var nothingUrl = "http://localhost:8080/nothing";
var detachUrl = "http://localhost:8080/detach";

export function nothing_tiny() {
  http.post(nothingUrl, tinyBody, {tags: {scenario: "nothing_tiny"}})
}

export function nothing_medium() {
  http.post(nothingUrl, mediumBody, {tags: {scenario: "nothing_medium"}});
}

export function nothing_large() {
  http.post(nothingUrl, largeBody, {tags: {scenario: "nothing_large"}});
}

export function detach_tiny() {
  http.post(detachUrl, tinyBody, {tags: {scenario: "detach_tiny"}});
}

export function detach_medium() {
  http.post(detachUrl, mediumBody, {tags: {scenario: "detach_medium"}})
}

export function detach_large() {
   http.post(detachUrl, largeBody, {tags: {scenario: "detach_large"}});
}
