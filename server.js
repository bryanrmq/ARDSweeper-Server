var express 	= require( 'express' );
var path		= require( 'path' );
var mysql      	= require( 'mysql' );
var session 	= require( 'express-session' );
var bodyParser 	= require( 'body-parser' );
var app 		= express();
var http = require('http').Server(app);
var io = require('socket.io')(http);


var map;

var MAX_PLAYERS = 4;
var BOMB_RATIO = 2;
var CODE_SIZE = 6;

var CODE_LEFT = 1;
var CODE_TOP = 2;
var CODE_RIGHT = 3;
var CODE_BOTTOM = 4;

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
	var rows = 10,
		cols = 10;
	map = generateMap(rows * cols, rows, cols);
}


function auth(username, password, fn) {
	//MySQL Query
	var query = "SELECT DISTINCT(users.id), users.username, tokens.token FROM users INNER JOIN tokens ON tokens.user_id = users.id WHERE users.username = '" + username + "' AND users.password = '" + password + "' ORDER BY tokens.created_at DESC";
	connection.query(query, function(err, rows, fields) {
		if(err)
			return fn(new Error(err.code));
		var user = {user: rows[0]};
		if(!user.user) return fn(new Error("User does not exist"));
		return fn(null, user);
	});
}

function register(u, p, fn) {
	var query = "INSERT INTO users SET ?";
	if(!u || !p)
		return fn(new Error("Les champs n'ont pas été renseignés."));

	connection.query(query, {username: u, password: p}, function(err, rows, fields) {
		if(err) 
			return fn(new Error("Erreur lors de l'inscription"));
		var id = rows.insertId;
		setToken(id, function(err, token) {
			if(token)
				return true;
			return false;
		})
		if(!id) return fn(new Error("User not registered"));
		return fn(null, id);
	});
}

function getUserByID(ID, fn) {
	connection.query("SELECT DISTINCT(users.id), users.username, tokens.token FROM users INNER JOIN tokens ON tokens.user_id = users.id WHERE users.id = ? ORDER BY tokens.created_at DESC", ID, function(err, rows, fields) {
		if(err)
			return fn(new Error(err.code));
		var user = {user: rows[0]};
		if(!user.user) return fn(new Error("User not found"));
		return fn(null, user);
	});
}

function setToken(ID, fn) {
	var t = Math.floor((Math.random() * 99999999999999) + 1000000000000); 
	connection.query("INSERT INTO tokens SET ?", {user_id: ID, token: t}, function(err, rows, fields) {
		if(err)
			return fn(new Error("Token can't be created"));
		token = rows.insertId;
		if(!token) return fn(new Error("Token not found"));
		return fn(null, token);
	});
}

function restrict(req, res, next) {
	if(req.session.user) {
		next();
	} else {
		req.session.error = "Access denied";
		res.redirect('/user/login');
	}
}

function _error(code, message) {
	error.code = code;
	error.message = message;
	log(message);
}

function log(message) {
	var date = new Date();
	console.log(date.getDate() + "/" + (date.getMonth() + 1) + "/" + date.getFullYear() + " - " + date.getHours() + ":" + date.getMinutes() + ":" + date.getSeconds() + " :: " + message);
}



function generateMap(n, rows, cols) {
	var map = [];
	for(i = 0; i < rows; i++) {
		map[i] = [];
		for(j = 0; j < cols; j++) {
			var bomb = Math.floor((Math.random() * BOMB_RATIO) + 1);
			if(bomb > 1)
				bomb = 0;
			map[i][j] = [bomb, 0];
		}
	}
	return map;
}

function generateCode() {
	var code = "";
	for(var i = 0; i < CODE_SIZE; i++)
		code = code + "" + Math.floor((Math.random() * 4) + 1);
	return code;
}



app.get('/', function(req, res) {
	res.send("Hello world !");
});

/**
*	POST: 
*/
app.post('/user/login', function(req, res) {
	var username = req.body.username,
        password = req.body.password;

    log("Login request");

    auth(username, password, function(err, user) {
    	if(user) {
    		req.session.regenerate(function() {
    			req.session.user = user;
    		});
    		log("Login success for User : " + user.user.username);
    		res.status(200).send(user);
    	} else {
			_error(err.code, err.message);
    		res.status(404).send(error);
    	}
    });
});

app.post('/user/register', function(req, res) {
	var username = req.body.username,
        password = req.body.password;

    log("Register request");

   	register(username, password, function(err, ID) {
   		if(ID) {
   			getUserByID(ID, function(err2, user) {
   				if(user) {
   					res.status(200).send(user);
    				log("Register success for User : " + user.user.username);
		    	} else {
					_error(err2.code, err2.message);
   					res.status(404).send(error);
   				}
   			});
   		} else {
			_error(err.code, err.message);
   			res.status(404).send(error);
   		}
   	});
});

app.get('/user/:id', function(req, res) {
    log("Get user request");
	var id = req.params.id;
	getUserByID(id, function(err, user) {
		if(user) {
    		log("Get user success");
			res.status(200).send(user);
		} else {
			_error(err.code, err.message);
			res.status(404).send(error);
		}
	});
});

io.on('connection', function(socket) {
	log("---------------------");
	log("---------------------");
	log("[Request] connection");

	socket.on('new player', function(username) {
		
		if(players.length >= 4) {
			log("[Emit] serveur full...");
			socket.emit("server full");
			socket.emit("disconnect");
		}

		socket.username = username;
		players.push(socket);
		log("[INTERNAL] user " + username + " added to players list");
		log("[INTERNAL] users : " + players.length + "/" + MAX_PLAYERS);
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
		log("[Request] set new position [" + x + "," + y + "]");
		if(map[x][y][0] == 1) {
			log("--- BOMB ---");
			var code = generateCode();
			log("Code : " + code);
			io.sockets.emit("bomb");
		} else {
			io.broadcast.emit("position", x, y);
		}
	});

	socket.on('code', function(token, code) {
		log("User Code");
	});

	socket.on('get full map', function(token) {
		log("[Request] full map");
		console.log(JSON.stringify(map));
		socket.emit('full map', map);
		log("[Emit] full map");
	});

	socket.on('full map client', function() {
		log("[Request] map fully loaded by the client");
		socket.emit('start game');
		log("[Emit] start the game");
	});

	socket.on('game loaded', function() {
		log("[Request] game successfully loaded");
	});

	socket.on('bomb desengaged', function() {
		log("BOMB DESENGAGED");
		socket.broadcast.emit("bomb explode");
	});	

	socket.on('disconnect', function() {
		log('[Request] client disconnect');
		var i = players.indexOf(socket);
		players.splice(i, 1);
	});

	socket.on('error', function (err) { console.error(err.stack); });

});



var server = http.listen( 3000, function() {

	var host = server.address().address;
	var port = server.address().port;

	setup();

	console.log("Server running at http://%s:%s", host, port);

});