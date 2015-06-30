var XMLHttpRequest  = require("xmlhttprequest").XMLHttpRequest;
var colors          = require( 'colors' );
var shell           = require( 'shelljs' );
var express 	    = require( 'express' );
var path		    = require( 'path' );
var mysql      	    = require( 'mysql' );
var session 	    = require( 'express-session' );
var bodyParser 	    = require( 'body-parser' );
var app 		    = express();
var http            = require('http').Server(app);
var io              = require('socket.io')(http);
var ioClient        = require('socket.io-client');

var master = "http://localhost:3000";

var args = process.argv.slice(2);
var port = args[0];
var id = args[1];
var name = args[2];

var map;
var rows = 10,
    cols = 10;

var MAX_PLAYERS = 4;
var BOMB_RATIO = 5;
var CODE_SIZE = 6;

var CODE_LEFT = 1;
var CODE_TOP = 2;
var CODE_RIGHT = 3;
var CODE_BOTTOM = 4;

var MESSAGE = 0;
var INFO = 1;
var WARNING = 2;
var ERROR = 3;
var SUCCESS = 4;


var players = [];

var error = {
    status: "error",
    code: 0,
    message: ""
};

/**
 MySQL Connect
 */
var connection = mysql.createConnection({
    host     : 'localhost',
    user     : 'root',
    password : 'h4Q{3e;L',
    database : 'ARDSweeper'
});

connection.connect(function(err) {
    if (err) {
        console.error('error connecting: ' + err.stack);
        return;
    }
    console.log('connected as id ' + connection.threadId);
});



/**
 Configurations
 */
app.use(bodyParser.json());
app.use(bodyParser.urlencoded( { extended: false } ));
app.use(session({
    resave: false,
    saveUninitialized: false,
    secret: "this is a secret passphrase"
}));


function setup() {
    map = generateMap(rows * cols, rows, cols);
    log(INFO, "Setting up...");
}

function restart(fn) {
    setup();
    return fn();
}

function ping() {
    var xmlHttp = new XMLHttpRequest();
    xmlHttp.open( "GET", master + "/server/" + id + "/live", false );
    xmlHttp.send( null );
    return xmlHttp.responseText;
}

function _error(code, message) {
    error.code = code;
    error.message = message;
    log(message);
}

function log(type, message) {
    type = type || MESSAGE;
    var date = new Date();

    //Parse date
    var day = date.getDate();
    var month = date.getMonth() + 1;
    var hours = date.getHours();
    var minutes = date.getMinutes();
    var seconds = date.getSeconds();

    if(day < 10) day = "0" + day;
    if(month < 10) month = "0" + month;
    if(hours < 10) hours = "0" + hours;
    if(minutes < 10) minutes = "0" + minutes;
    if(seconds < 10) seconds = "0" + seconds;

    var output = day + "/" + month + "/" + date.getFullYear() + " - " + hours + ":" + minutes  + ":" + seconds + " :: " + message;

    switch (type) {
        case MESSAGE :
            console.log(output);
            break;

        case SUCCESS :
            console.log(colors.green(output));
            break;

        case INFO :
            console.log(colors.cyan(output));
            break;

        case WARNING :
            console.log(colors.yellow(output));
            break;

        case ERROR :
            console.log(colors.red(output));
            break;
    }
}


function generateMap(n, rows, cols) {
    map = [];
    for(var y = 0; y < rows; y++) {
        map[y] = [];
        for(var x = 0; x < cols; x++) {
            var bomb = Math.floor((Math.random() * BOMB_RATIO) + 1);
            if(bomb > 1)
                bomb = 0;
            map[y][x] = [bomb, -1, 0];
        }
    }

    for(var y = 0; y < rows; y++) {
        for( var x = 0; x < cols; x++) {
            map[y][x][1] = checkBombsAround(x, y);
        }
    }

    return map;
}

function checkBombsAround(x, y) {
    var n = 0;
    var length = rows;

    n += (isBomb(y - 1, x - 1) ? 1 : 0); // top left
    n += (isBomb(y - 1, x) ? 1 : 0); // top center
    n += (isBomb(y - 1, x + 1) ? 1 : 0); // top right
    n += (isBomb(y, x - 1) ? 1 : 0); // center left
    n += (isBomb(y, x + 1) ? 1 : 0); // center right
    n += (isBomb(y + 1, x - 1) ? 1 : 0); // bottom left
    n += (isBomb(y + 1, x) ? 1 : 0); // bottom center
    n += (isBomb(y + 1, x + 1) ? 1 : 0); // bottom right

    return n;
}

function isBomb(y, x) {
    if(x < 0 || y < 0 || x >= rows || y >= rows)
        return false;
    if(map[y][x][0] == 1)
        return true;
    return false;
}

function generateCode() {
    var code = "";
    for(var i = 0; i < CODE_SIZE; i++)
        code = code + "" + Math.floor((Math.random() * 4) + 1);
    return code;
}

function endGame() {
    var i = 0;
    for(var y = 0; y < rows; y++) {
        for(var x = 0; x < rows; x++) {
            if(map[y][x][2] == 1)
                i++;
        }
    }
    if(i == rows * cols)
        return true;
    return false;
}


app.get('/', function(req, res) {
    res.send("Hello world !");
});

io.on('connection', function(socket) {
    log(MESSAGE, "---------------------");
    log(MESSAGE, "---------------------");
    log(INFO, "[Request] connection");

    socket.on('new player', function(username) {
        if(players.length >= 4) {
            log("[Emit] serveur full...");
            socket.emit("server full");
            socket.emit("disconnect");
        }

        socket.username = username;
        players.push(socket);
        log(SUCCESS, "[INTERNAL] user " + username + " added to players list");
        log(INFO, "[INTERNAL] users : " + players.length + "/" + MAX_PLAYERS);
        socket.broadcast.emit("new player");
    });

    /*
     socket.on('get players list', function() {
     log("[Request] get player list");
     socket.emit('players list', players);
     log("[Emit] player list");
     });
     */

    socket.on('position', function(x, y) {
        x = parseInt(x);
        y = parseInt(y);

        log(INFO, "[Request] set new position [" + x + "," + y + "]");
        if(map[x][y][0] == 1) {
            map[x][y][1] = -3;
            log(WARNING, "--- BOMB ---");
            var code = generateCode();
            log(WARNING, "Code : " + code);
            io.sockets.emit("bomb");
        }
        map[x][y][2] = 1;
        var checked = map[x][y][2];
        var state = map[x][y][1];
        io.sockets.emit("position", x, y, state, checked);

        if(endGame()) {
            log(INFO, "Game Over");
            io.sockets.emit("game over");
            log(WARNING, "RESTART");
            log(WARNING, "RESTART");
            log(WARNING, "RESTART");
            io.sockets.emit("restart");
            restart(function() {
                io.sockets.emit("restart map");
            });
        }
    });

    socket.on('code', function(token, code) {
        log(INFO, "User Code");
    });

    socket.on('get full map', function(token) {
        log(INFO, "[Request] full map");
        socket.emit('full map', map);
        log(JSON.stringify(map));
        log(INFO, "[Emit] full map");
    });

    socket.on('full map client', function() {
        log(INFO, "[Request] map fully loaded by the client");
        socket.emit('start game');
        log(INFO, "[Emit] start the game");
    });

    socket.on('game loaded', function() {
        log(SUCCESS, "[Request] game successfully loaded");
    });

    socket.on('bomb desengaged', function() {
        log(SUCCESS, "BOMB DESARMED");
        socket.broadcast.emit("bomb explode");
    });

    socket.on('disconnect', function() {
        log(WARNING, '[Request] client disconnect');
        var i = players.indexOf(socket);
        players.splice(i, 1);
    });

    socket.on('pong', function() {
       socket.emit('ping');
    });

    socket.on('error', function (err) { console.error(err.stack); });

});

app.get('/players', function(req, res) {
    //Liste des serveurs
    log(INFO, "[SERVER][GET] get players");
    res.status(200).send(players.length);
});


var server = http.listen( port, function() {

    var host = server.address().address;
    var port = server.address().port;

    shell.exec("clear");

    setup();
    ping();
    setInterval(ping, 5000);

    log(INFO, "game server (" + id + ") start running at port " + port);

});