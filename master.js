var XMLHttpRequest  = require( "xmlhttprequest" ).XMLHttpRequest;
var colors          = require( 'colors' );
var shell           = require( 'shelljs' );
var express 	    = require( 'express' );
var path		    = require( 'path' );
var mysql      	    = require( 'mysql' );
var session 	    = require( 'express-session' );
var bodyParser 	    = require( 'body-parser' );
var app 		    = express();
var http = require('http').Server(app);
var io = require('socket.io')(http);

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

/*
Configurations
*/
app.use(bodyParser.json());
app.use(bodyParser.urlencoded( { extended: false } ));
app.use(session({
    resave: false,
    saveUninitialized: false,
    secret: "this is a secret passphrase"
}));

var MESSAGE = 0;
var INFO = 1;
var WARNING = 2;
var ERROR = 3;
var SUCCESS = 4;

var port = 3000;

var servers = [];
var MAX_PLAYERS = 4;

var error = {
    status: "error",
    code: 0,
    message: ""
};

function setup() {
    getServers(null);
}

function getServers(fn) {
    var query = "SELECT * FROM servers";
    connection.query(query, function(err, results) {
        if(err)
            return fn(new Error(err.code));
        for(var i = 0; i < results.length; i++) {
            servers.push(results[i]);
            servers[i].live = false;
        }
    });
}

function getFreeServer() {
    for(var i = 0; i < servers.length; i++) {
        if(getPlayers(servers[i].id) < MAX_PLAYERS && servers[i].live)
            return servers[i];
    }
    return null;
}

function getIndexServerByID( ID ) {
    for(var i = 0; i < servers.length; i++) {
        if(servers[i].id == ID)
            return i;
    }
    return -1;
}

function watchServers() {
    for(var i = 0; i < servers.length; i++) {
        var now = new Date();
        if(servers[i].live == false)
            continue;
        if(now - servers[i].last_ping > 15000) {
            servers[i].live = false;
            log(WARNING, "[SERVER][" + servers[i].id + "] SHUT DOWN...");
        }
    }
}

function getPlayers(serverID) {
    var idx = getIndexServerByID(serverID);
    var xmlHttp = new XMLHttpRequest();
    xmlHttp.open( "GET", "http://localhost:" + servers[idx].port + "/players", false );
    xmlHttp.send( null );
    return xmlHttp.responseText;
}


/*
 EXPRESS
 */
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

function authToken(token, fn) {
    //MySQL Query
    var query = "SELECT DISTINCT(users.id), users.username, tokens.token FROM users INNER JOIN tokens ON tokens.user_id = users.id WHERE tokens.token = '" + token + "'";
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

function _error(code, message) {
    error.code = code;
    error.message = message;
    log(ERROR, message);
}

function log(type, message) {
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


/**
 *	POST:
 */

app.post('/user/login', function(req, res) {
    var username = req.body.username,
        password = req.body.password;

    log(INFO, "[USER][POST] Login request");

    auth(username, password, function(err, user) {
        if(user) {
            req.session.regenerate(function() { req.session.user = user; });
            log(SUCCESS, "[USER][POST] Login success for user : " + user.user.username);
            user.server = getFreeServer();
            user.server.portString = "" + user.server.port;
            res.status(200).send(user);
        } else {
            _error(err.code, err.message);
            res.status(404).send(error);
        }
    });
});

app.post('/user/login/:token', function(req, res) {
    var token = req.params.token;

    log(INFO, "[USER][POST] Login request by token");

    authToken(token, function(err, user) {
        if(user) {
            req.session.regenerate(function() {
                req.session.user = user;
            });
            log(SUCCESS, "[USER][POST] Login by token success for user : " + user.user.username);
            user.server = getFreeServer();
            user.server.portString = "" + user.server.port;
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

    log(INFO, "[USER][POST] Register request");

    register(username, password, function(err, ID) {
        if(ID) {
            getUserByID(ID, function(err2, user) {
                if(user) {
                    res.status(200).send(user);
                    log(SUCCESS, "[USER][POST] Register success for User : " + user.user.username);
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

app.get('/', function(req, res) {
   res.status(200).send("Hello World !");
});

app.get('/servers', function(req, res) {
    //Liste des serveurs
    log(INFO, "[SERVER][GET] get servers");
    res.status(200).send(servers);
});

app.get('/server/:id/live', function(req, res) {
    var idx = getIndexServerByID(req.params.id);
    servers[idx].live = true;
    servers[idx].last_ping = new Date();
    log(MESSAGE, "[PING][" + servers[idx].id + "] serveur " + servers[idx].name + " is alive");
    res.status(200).send(1);
});

app.get('/user/:id', function(req, res) {
    log(INFO, "[USER][GET] user request");
    var id = req.params.id;
    getUserByID(id, function(err, user) {
        if(user) {
            log(SUCCESS, "[USER][GET] Get user success");
            res.status(200).send(user);
        } else {
            _error(err.code, err.message);
            res.status(404).send(error);
        }
    });
});

var server = http.listen( port, function() {
    var host = server.address().address;
    var port = server.address().port;

    setup();
    setInterval(watchServers, 1000);

    shell.exec("clear");

    console.log("################");
    console.log("----------------");
    console.log("\n");
    console.log("## ARDSweeper Master Server");
    log(SUCCESS, "map generated : OK");
    log(SUCCESS, "servers loaded : OK");
    log(SUCCESS, "servers pings : OK");
    log("...");
    log(SUCCESS, "Loading : OK");
    log(INFO, "Master Server started at http://" + host + ":" + port);
});