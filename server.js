"use strict"

/*
	A mock Timeline Server
*/

var http = require('http'),
	url = require('url'),
	path = require('path'),
	fs = require('fs'),
  qs = require('querystring'),

  cache = {},
  uiDomain = process.argv[2] || 'http://localhost:9001',
	port = parseInt(process.argv[3], 10) || 8188,
  
  ERROR_RESPONSE = '{"exception":"NotFoundException","message":"java.lang.Exception: Timeline entity { id: dag_1415292900390_0001_11.hh, type: TEZ_DAG_ID } is not found","javaClassName":"org.apache.hadoop.yarn.webapp.NotFoundException"}',
  ENTITIES_SNIPPET = '{"entities"',
  FILE_NOT_FOUND_ERR = "File Not Found",
  NOT_CACHED = "Data Not Cached";

//Accepts JSON as data
function setData(requestPath, data) {
  var parsedData = JSON.parse(data);

  if(parsedData.entities) {
    parsedData.entities.forEach(function (entity) { // Hash all entities for easy access, just a ref no much extra memory use.
      parsedData[entity.entity] = entity;
    });
  }

  cache[requestPath] = parsedData;
}

function getFilters(query) {
  var filters = [];

  if(query.primaryFilter) filters = filters.concat(query.primaryFilter.split(','));
  if(query.secondaryFilter) filters = filters.concat(query.secondaryFilter.split(','));

  if(!filters.length) return null;

  return filters.reduce(function (obj, val) {
    var delimIndex = val.indexOf(":");
    if(delimIndex > 0) obj[val.substr(0, delimIndex)] = val.substr(delimIndex + 1);
    return obj;
  }, {});
}

function filterCheck(entity, filters) {
  for(var filterName in filters){
    if(!entity.primaryfilters[filterName]) return false;
    if(entity.primaryfilters[filterName].indexOf(filters[filterName]) == -1) return false;
  }
  return true;
}

//Returns JSON/null
function getData(requestPath, query) {
  var data = cache[requestPath],
      returnData,
      startIndex = 0,
      filters;

  if(!data) return null; // No data
  if(!query.limit) returnData = query.fromId ? data[query.fromId] : data;
  else {
    if(!data.entities) return null; //No entities array, hence cannot return limit number of entities

    if(data[query.fromId]) { // No entity id/from id specified, so startIndex = 0
      startIndex = data.entities.indexOf(data[query.fromId]);
      if(startIndex == -1) return null; // Entity not found in the adday
    }

    filters = getFilters(query);
    if(filters) { // Filter
      returnData = [],
      data = data.entities;

      for(var i = startIndex, length = data.length; i < length && returnData.length < query.limit; i++) {
        if(filterCheck(data[i], filters)) returnData.push(data[i]);
      }
    }
    else {
      returnData = data.entities.slice(startIndex, startIndex + query.limit);
    }

    returnData = {
      entities: returnData
    };
  }

  return JSON.stringify(returnData);
}

function readFile(filePath, callback) {
  fs.exists(filePath, function(exists) {
    if(exists) {
      if (fs.statSync(filePath).isDirectory()) filePath = path.join(filePath, '/index.json');
      fs.readFile(filePath, callback);
    }
    else callback(FILE_NOT_FOUND_ERR);
  });
}

function readData(requestPath, query, callback) {
  var data = getData(requestPath, query);

  if(data) callback(null, data);
  else readFile(requestPath, function (err, data) {
    if(!err) {
      setData(requestPath, data);

      data = getData(requestPath, query);
      if(data) callback(null, data);
      else callback(NOT_CACHED);
    }
    else if(!query.fromId && err == FILE_NOT_FOUND_ERR) { // Go one level deeper, to fetch entities from inside the index files
      query.fromId = path.basename(requestPath); // Use base name as the entity id
      readData(path.dirname(requestPath), query, callback);
    }
    else callback(err, data);
  });
}

http.createServer(function(request, response) {
  var parsedUrl = url.parse(request.url),
      requestPath = path.join(process.cwd(), 'data/', parsedUrl.pathname),
      query = qs.parse(parsedUrl.query);

  query.limit = parseInt(query.limit) || 0;

  readData(requestPath, query, function (err, data) {
    var status, log;

    if(err) status = 404, data = ERROR_RESPONSE, log = "Err:" + err;
    else status = 200, log = "Success!";

    response.setHeader('Access-Control-Allow-Credentials', true);
    response.setHeader('Access-Control-Allow-Origin', uiDomain);

    response.writeHead(status, {'Content-Type': 'application/json'});
    response.write(data);
    console.log("Rquested for " + requestPath + " : " + log);
    response.end();
  });

}).listen(port, function(err){
	if(err) {
		console.log("Unable to listen : ", err);
	}
	else {
		console.log(
        "Timeline Server running at http://localhost:" +
        port +
        "/ expecting requests from " +
        uiDomain +
        "\nUse CTRL+C to shutdown");
	}
});

