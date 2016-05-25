// Getting all dependencies
const express = require('express');
const app = express();
const mongoose = require('mongoose');
// var postmark = require("postmark")(process.env.POSTMARK_API_KEY);
const geoConst = require('./data/geoConst.json');
const http = require('http').Server(app);
const io = require('socket.io')(http);
const bodyParser = require('body-parser');
const geoUtils = require('./lib/geoutils');
const schedule = require('./lib/cronSchedules');

// Proper logging
const bunyan = require('bunyan');
const log = bunyan.createLogger({ name: 'transitTracks' });
log.info('Bunyan initialized.');

var pastStopSeq = 18;
var nextStopSeq = 0;
var possibleSkip = false;

// ALL the vehicles
var vehicles = [];

// edit


// Setup DB
const mongoUser = process.env.MONGO_USERNAME;
const mongoPass = process.env.MONGO_PASSWORD;
const mongoUrl = `mongodb://${mongoUser}:${mongoPass}@localhost:27017/hsvtransit`;
mongoose.connect(mongoUrl);

// Shuttle/trolly/auto DB setup
const transitSchema = new mongoose.Schema({
  id: Number,
  long: Number,
  lat: Number,
});
const Transit = mongoose.model('Transit', transitSchema);

var allLocations = [];

// Event DB structure
const eventSchema = new mongoose.Schema({
  id: Number,
  time: String,
  date: String,
  name: String,
  desciption: String,
  xcorr: Number,
  ycoor: Number,
});
const Event = mongoose.model('Event', eventSchema);

// Statistics DB structure
const statsSchema = new mongoose.Schema({
  id: Number,
  hits: Number,
});
const Stats = mongoose.model('Stats', statsSchema);

const userConnSchema = new mongoose.Schema({
  id: String,
  cipaddr: String,
  connStart: { type: Date, default: Date.now },
  connEnd: Date,
});
const UserConn = mongoose.model('UserConn', userConnSchema);

const userSchema = new mongoose.Schema({
  email: String,
  name: String,
  pass: String,
});
const User = mongoose.model('User', userSchema);

app.set('port', (process.env.PORT || 5000));

// Setting directory structure
app.set('views', `${__dirname}/views`);
app.set('view engine', 'ejs');
app.use(express.static(`${__dirname}/public`));

app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

// Setup socket.io
// app.http().io();

app.get('/', (req, res) => {
  res.render('pages/index');
  Stats.find({id: 0}, (err, stat) => {
    var statContents = stat;
    if (statContents[0]) {
      statContents[0].hits += 1;
      statContents[0].save();
    }
  });
});

app.get('/test', (req, res) => {
  io.emit('location update', [34.73172, -86.58979]);
  res.send('Success');
});


app.get('/stats', (req, res) => {
  Stats.find({ id: 0 }, (err, stat) => {
    if (stat[0]) {
      res.send(`Hits:${stat[0].hits}`);
    } else {
      res.send('Error getting stats.');
    }
  });
});



// IS THIS API USED????--------------------------------------
// Adds account
/*
app.post('/api/v1/account', (req, res) => {
  Transit.find({ id: transitId }, (err, transit) => {
    if (transit[0]) {
      res.send('Account already created');
    } else {
      var newTransit = new Transit({ id: transitId, lat: 0, long: 0});
      newTransit.save();
      res.send('Account created');
    }
  });
});
*/

// Reads account ----- TOBE REMOVED -----------------
// Updates account
// app.post('/api/v1/account/:id', function(req, res) {
//   res.send('Hello world!');
// });

// Reads account ----- TOBE REMOVED -----------------
// app.get('/api/v1/account/:id', function(req, res) {
//   res.send('Hello world!');
// });

// Adds location
app.post('/api/v1/trolly/:id/location', (req, res) => {
  var returnStr = 'location api called ';
  var transitId = req.params.id;
  var vehicleFound = false;
  for (var i = 0; i < vehicles.length; i++) {
    if (vehicles[i].id === transitId) {
      vehicleFound = true;
      if (geoUtils.contains([req.body.lat, req.body.lon], geoConst.dtBounds)) {
        vehicles[i].lat = req.body.lat;
        vehicles[i].long = req.body.lon;
        //  checkStops([vehicles[i]['lat'],vehicles[i]['long']]);
        returnStr = returnStr.concat('location updated');
      } else {
        returnStr = returnStr.concat('location update failed');
        console.log('Invalid location update');
      }
    }
  }
  if (vehicleFound === false) {
    vehicles.push({ id: transitId, lat: req.body.lat, long: req.body.lon });
    returnStr = 'new bus location added';
    console.log(returnStr);
  }
  res.send(returnStr);
  /*
  Transit.find({id: transitId}, function( err, transit ) {
    returnStr = "updating location";
    if( transit[0] ) {
      returnStr = 'Recording location into DB: ' + transit[0].id + " - ";
      if (geoUtils.contains([req.body.lat,req.body.lon], geoConst.dtBounds)) {
        transit[0].lat = req.body.lat;
      transit[0].long = req.body.lon;
      checkStops([transit[0].lat,transit[0].long])
      transit[0].save();
      returnStr = returnStr.concat("db updated");
      } else {
      returnStr = returnStr.concat("db update failed");
      console.log('Invalid credentials in location update');
      }
    } else {
      newTransit = new Transit( {id: transitId, long: req.body.lng, lat: req.body.lat} );
      newTransit.save();
      returnStr = "new bus location added";
      console.log(returnStr);
    }
    res.send(returnStr);
  });
  */
});

/*
Reads account ----- TOBE REMOVED -----------------
Reads location
app.get('/api/v1/trolly/:id/location', function(req, res) {
  res.send('Hello world!');
});

Reads account ----- TOBE REMOVED -----------------
Gets status of trollies
app.get('/api/v1/trollies', function(req, res) {
  res.send('Hello world!');
});

Reads account ----- TOBE REMOVED -----------------
Gets stops for a single trolley
app.get('/api/v1/trollies/:id/stops', function(req, res) {
  res.send('Hello world!');
});
*/

var latLng = [];
var locations;
var latLongs = {};


/*
function findLocations() {
  //  console.log('Updating current location');
  Transit.find({},{id:1,lat:1,long:1,_id:0}, function(err, transit) {
    //  console.log("Getting coords for " + transit.length)
    if( transit.length > 0 ) {
      allLocations = transit;
    } else {
      console.log('DB credentials supplied incorrect');
    }
  });
}
*/

function checkStops(curPnt) {
  // console.log("checking to see if near stop: nextStop = " + nextStopSeq + " : " + curPnt);
  // for each in stop array
  var sb = null //  --geoUtils.setStopBounds(nextStopSeq -1);
  var ns = nextStopSeq;
  var len = geoConst.dtStopArray.length - 1;
  var advance = false;
  var fin = false;
  // while (!advance && !fin) {
      // var cnt = ns;
  for (var i = 0; i < len && !advance; ++i) {
    var test_b = geoUtils.setStopBounds(ns - 1);
      // console.log("testing: " + ns);
    if (geoUtils.contains(curPnt, test_b)) {
    // if (nextStopSeq === pastStopSeq + 1 ) {
      advance = (nextStopSeq === i);
    // } else {
    //  advance = false;
    // }
      if (advance) {
        pastStopSeq = i;
        nextStopSeq = i + 1;
          //  nextStopBounds = geoUtils.setStopBounds(nextStopSeq -1);
        console.log(`advancing stop seq = ${nextStopSeq} : ${pastStopSeq}`);
        var data = {seq:nextStopSeq,  route:'Downtown', id:0 }
        io.emit('next stop', data);
        return;
      }
    } else {
      ns = ns < len ? ++ns : 1;
      //  console.log("next test: " + ns);
    }
      //  console.log("nextStop now = " + nextStopSeq);
  }
}

// var interval = setInterval(function(){findLocations();},3000);
/* TO BE REMOVED --------------------------------------------------
function checkTime() {
   TODO: REPLACE this function with isTrolleyInactive();
   would like to extend this to start at 4pm and end at 1am following morning... of course
   that complicates the testing
  var trolleyInactive = true;
  var date = new Date();
  date.setHours(date.getHours());
  console.log("hour: " + date.getHours() + ", day: " + date.getDay());
  if ( date.getHours() <= 24 && date.getHours() >= 17  ) {
    if ( 5 == date.getDay() || 6 == date.getDay() ) {
      trolleyInactive = false;
    } else {
      trolleyInactive = true;
    }
  } else {
    trolleyInactive = true;
  }
  return trolleyInactive;
}
--------------------------------------------------------------------*/
function locationRecieved(data) {
  var returnStr = 'location socket called: ';
  var transitId = data.id;
  var vehicleFound = false;
  console.log(`here: ${data.id} : ${data.lat} - ${data.lon}`);
  for (var i = 0; i < vehicles.length; i++) {
    if(vehicles[i]['id']==transitId) {
      vehicleFound = true;
      if (geoUtils.contains([data.lat,data.lon], geoConst.dtBounds)) {
        vehicles[i]['lat'] = data.lat;
        vehicles[i]['long'] = data.lon;
        //  checkStops([vehicles[i]['lat'],vehicles[i]['long']]);
        returnStr = returnStr.concat("location updated");
      } else {
        returnStr = returnStr.concat("location update failed");
        console.log('Invalid location update');
      }
    }
  }
  if (vehicleFound === false) {
    vehicles.push({'id': transitId, 'lat': data.lat, 'long': data.lon});
    returnStr = "new bus location added";
    console.log(returnStr);
  }
  return returnStr;
}

// Trolley Service Schedule - Will need schedule for each route
function isTrolleyInactive() {
  // would like to extend this to start at 4pm and end at 1am following morning... of course
  // that complicates the testing
  var trolleyInactive = true; // named the variable for readability
  var date = new Date();
  date.setHours(date.getHours()); // minus 6 from UTC time - CHANGE for DAYLIGHT/STANDARD TIME
  console.log("hour: " + date.getHours() + ", day: " + date.getDay());

  if (date.getDay() === 5 && date.getHours() <= 24 && date.getHours() >= 16) {
    console.log("first test: " + trolleyInactive);
    trolleyInactive = false;
  }

  if (trolleyInactive && date.getDay() === 6 && ( (date.getHours() <= 24 &&
       date.getHours() >= 16) || (date.getHours() === 0))) {
    console.log(`second test: ${trolleyInactive}`);
    trolleyInactive = false;
  }

  if ( trolleyInactive && date.getDay() == 0 && date.getHours() == 0 ) {
      console.log("third test: " + trolleyInactive);
    trolleyInactive = false;
  }
  return trolleyInactive;
}

// Everything socket.io related
io.sockets.on('connection', function(socket) {
  /*
  Object.keys(socket).forEach(function (key) {
     console.log("key (socket): " + key + " value: " + (socket)[key]);
    console.log("address: " + socket.handshake.address);
  });
  */
  console.log("id: " + socket.id + " address: " + socket.handshake.address);
  //  newConnect = new UserConn ( {id: socket.id, cipaddr: socket.handshake.address, connStart: new Date(), connEnd: null} )
  //  newConnect.save();
  // TODO will need an flag set if the connection is from beacon or client user ---

  io.emit('made connect', {nextSeq:nextStopSeq,greet:'hello there'}); // sent to client user


  //  BEACON listerns won't hear anything until sockets on the beacon is implementation-----
  socket.on('bus:connect', function(data) {
    console.log('bus connected: ' + data.id + " : " + data.pw);
    console.log('bus connected: ' + socket.id + " address: " + socket.handshake.address);
  });
  socket.on('bus:location', function(data) {  //  bus:location
    console.log('location update: ' + data.id + " : " + data.lat + " - " + data.lon);
    locationRecieved(data);
    //  TODO update vehicles here...;
  });
    //  --------------------------------------------------------------------------------------------

  socket.on('get location', function( data ) {
  //  console.log('location update requested ');
    //  console.log(allLocations);
    //  if(isTrolleyInactive()) {
    if(false) {
      console.log('Sending dormant signal');
      io.emit('trolley off', [0,0]);
    //  io.emit('location update', allLocations); need to change this when running simulation
    } else {
      console.log('Sending coordinates');
      io.emit('location update', vehicles);
    }
  });
    socket.on('disconnect', function() {
      console.log('User disconnected');
    UserConn.find({id: socket.id}, function( err, uc ) {
    returnStr = "updating connection";
    if( uc[0] ) {
      returnStr = 'Recording user connection diconnect: ' + uc[0].cipaddr + " - ";
          uc[0].connEnd = new Date();
      uc[0].save();
      returnStr = returnStr.concat("db updated");
    } else {
      returnStr = returnStr.concat("db update failed");
      console.log('Invalid credentials in connection update');
    }
      });
  });
});



/*************************************************
*Admin Functionality
*WARNING: Suspending development of section indefinitely
*************************************************/
/*
app.get('/admin', function(req, res) {
  var updates = [];
  res.render('pages/admin', {messages: updates});
});

app.get('/admin/addevent', function(req, res) {
  res.render('pages/eventadd');
});
*/

// Opening server to requests
http.listen(app.get('port'), () => {
  console.log('Node app is running on port ', app.get('port'));
  var d = new Date();
  d.setHours(d.getHours());
  log.info(`Time: ${d.getTime()}, Day: ${d.getDay()}, Hour: ${d.getHours()}`);
});



//  --- Test stuff ---------------------------------------

log.info(`Trolley Home: ${geoConst.trolleyHome}`);

//  console.log('read array ' + geoConst.dtStopArray[seq1][1]);
/*
var testsend = require('./lib/sendNotification');
var to = "contact@hoparoundhuntsville.com"
var subject = "Message from user on Hop Around Huntsville"
var message = "This is a test message... hoparoundhuntsville on transittracks-dev has fired up"
var response = null;
testsend.send(to, subject, message, response);
*/
//  ----------------------------------------------------------------------------------
