var express 	= require( 'express' );
var path		= require( 'path' );
var mysql      	= require( 'mysql' );
var session 	= require( 'express-session' );
var bodyParser 	= require( 'body-parser' );
var app 		= express();
var http = require('http').Server(app);
var io = require('socket.io')(http);


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
	var map = new Array( new Array() );
	for(i = 0; i < rows; i++) {
		for(j = 0; j < cols; j++) {
			map[i][j] = {
				mine: true,
				state: 0
			};
		}
	}
	return map;
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
	log("User connected.");
});

io.on('disconnect', function(socket) {
	log("User disconnected");
});

io.on('position', function(socket) {
	log("get Position");
});

io.on('position change', function(socket) {
	log("New Position");
});

io.on('code', function(socket) {
	Log("User Code");
});


var server = http.listen( 3000, function() {

	var host = server.address().address;
	var port = server.address().port;

	console.log("Server running at http://%s:%s", host, port);

});