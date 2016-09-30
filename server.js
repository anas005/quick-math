var http = require('http');
var express = require('express');
var bodyParser = require('body-parser');
var socketio = require('socket.io');
var shuffle = require('./lib/shuffle').knuthShuffle
var app = express();
var server = http.createServer(app);
var io = socketio.listen(server);
var users = [];
var nodes = { };
var usernames = { };
var game = {
  question  : null,
  answer    : null,
  scores    : {},
  isStarted : false
}

server.listen(process.env.PORT || 3000);

app.set('view engine', 'ejs');
app.set('view options', { layout: false });
app.use('/public', express.static('public'));

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

app.get('/', (req, res) => {
  res.render('index', { status : "start", name : "" });
});

app.post('/play', function (req, res) {
  var name = req.body.name;
  if ( game.isStarted )
    res.render('index', { status : "error", errorText : "Game has already started", name : name });
  else if ( !name )
    res.render('index', { status : "error", errorText : "Enter a name to continue", name : name });
  else if ( users.indexOf(name) != -1 )
    res.render('index', { status : "error", errorText : "User with this name already logged in", name : name });
  else {
    res.render('game', { name : name });
  }
});

function generateQandA(){
  var question = Math.ceil(Math.random()*50) + " + " + Math.ceil(Math.random()*50) + " = ?";
  var answer = eval(question.substring(0,question.indexOf("=")));
  game.answer = answer;
  game.QandA = {question: question, answers: shuffle([answer, answer+1, answer-1, answer+10])};
  console.log("generated question is " + question + "\nanswer is " + answer );
}

io.sockets.on('connection', socket => {
  socket.on('sendAnswer', data => {
    if(!game.isStarted) 
      return false;
    if (game.answer == data) {
      //console.log("correct answer");
      game.scores[socket.username] += 10;
      generateQandA();
      socket.emit('result', {isCorrect : true});
      game.QandA.previousAnswer = data;
      socket.emit('question', game.QandA);
      socket.broadcast.emit('question', game.QandA);
    } else {
      //console.log("incorrect answer");
      game.scores[socket.username] -= 10;
      socket.emit('result', {isCorrect : false});
    }
    console.dir(game.scores);
    io.sockets.emit('updateScore', game.scores);
    socket.broadcast.emit('updateScore', game.scores);
  });

  socket.on('adduser', username => {
    if(game.isStarted) return false;
    socket.username = username;
    usernames[username] = username;
    users.push(username);
    game.scores[username] = "Not Ready";
    io.sockets.emit('updateusers', game.scores);
    socket.emit('servernotification', { connected: true, to_self: true, username: username });
    socket.broadcast.emit('servernotification', { connected: true, username: username });
    //generateQandA();
    //socket.emit('question', game.QandA);
    //socket.broadcast.emit('question', game.QandA);
  });

  socket.on('playAgain', username => {
    if(game.isStarted) return false;
    console.log(username + " is ready to play again...");
    game.scores[username] = "Ready";
    io.sockets.emit('updateusers', game.scores);
    socket.emit('sendReady');
    //socket.emit('servernotification', { connected: true, to_self: true, username: username });
    //socket.broadcast.emit('servernotification', { connected: true, username: username });
  });

  socket.on('ready', username => {
    var isEveryoneReady = true;
    console.log(username + " is ready to play...");
    game.scores[username] = "Ready";
    io.sockets.emit('updateusers', game.scores);
    for (var i = 0; i < users.length; i++) {
      if ( game.scores[users[i]] != "Ready" ) {
        console.log(users[i] + " not ready...");
        isEveryoneReady = false;
      }
    }
    if (isEveryoneReady) {
      console.log("Everyone ready...");
      for (var i = 0; i < users.length; i++) {
        game.scores[users[i]] = 0;
      }
      io.sockets.emit('updateusers', game.scores);
      generateQandA();
      socket.emit("game", { action : "start" });
      socket.broadcast.emit("game", { action : "start" });
      setTimeout(function() {
        socket.emit('question', game.QandA);
        socket.broadcast.emit('question', game.QandA);
        game.isStarted = true;
        var startTime = new Date();
        var checkTime = setInterval(function() {
          var elapsedTime = Math.floor((new Date() - startTime)/1000);
          //console.log("elapsed time is " + elapsedTime);
          if (elapsedTime >= 60) {
            console.log("Time's up...");
            clearInterval(checkTime);
            game.isStarted = false;
            var sortedUsers = Object.keys(game.scores).sort(function(a, b) {
              return game.scores[a] < game.scores[b];
            });
            var winner = sortedUsers[0];
            //var winner = sortedUsers[0] == socket.username ? "you" : sortedUsers[0];
            socket.emit("game", { action : "stop", winner : winner });
            socket.broadcast.emit("game", { action : "stop", winner : winner });
            for (var i = 0; i < users.length; i++) {
              game.scores[users[i]] = "Not Ready"
            }
          }
        }, 1000);
      }, 3000);
    } else {
      console.log("Someone Not ready...")
    }
  });

  socket.on('disconnect', () => {
    delete usernames[socket.username];
    delete game.scores[socket.username];
    users.splice(users.indexOf(socket.username),1);
    io.sockets.emit('updateusers', game.scores);
    socket.broadcast.emit('servernotification', { username: socket.username });
  });
});