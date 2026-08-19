// server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
const path = require('path');

// Fai servire a Node i file statici di React
app.use(express.static(path.join(__dirname, 'build')));

// Per qualsiasi altra richiesta, mostra il sito
app.get(/(.*)/, (req, res) => {
  res.sendFile(path.join(__dirname, 'build', 'index.html'));
});
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

// Stato del gioco in memoria RAM
const rooms = {};

const shuffle = (array) => array.sort(() => Math.random() - 0.5);

function assignRoles(players) {
    const count = players.length;
    // 1 Lupo ogni 4 giocatori, 1 Veggente se si è almeno in 4, il resto Contadini
    const numLupi = Math.max(1, Math.floor(count / 4));
    const numVeggente = count > 3 ? 1 : 0; 
    const numContadini = Math.max(0, count - numLupi - numVeggente);

    let rolesPool = [];
    for(let i = 0; i < numLupi; i++) rolesPool.push('Lupo');
    for(let i = 0; i < numVeggente; i++) rolesPool.push('Veggente');
    for(let i = 0; i < numContadini; i++) rolesPool.push('Contadino');

    let assigned = [];
    let remainingPlayers = [...players];

    // Assegnazione in base alle preferenze
    ['Lupo', 'Veggente'].forEach(role => {
        let needed = role === 'Lupo' ? numLupi : numVeggente;
        let candidates = shuffle(remainingPlayers.filter(p => p.preference === role));

        while(needed > 0 && candidates.length > 0) {
            let p = candidates.pop();
            assigned.push({ ...p, role: role });
            remainingPlayers = remainingPlayers.filter(rp => rp.id !== p.id);
            rolesPool.splice(rolesPool.indexOf(role), 1);
            needed--;
        }
    });

    // Riempimento casuale
    rolesPool = shuffle(rolesPool);
    remainingPlayers.forEach((p, i) => {
        assigned.push({ ...p, role: rolesPool[i] || 'Contadino' });
    });

    return assigned;
}

io.on('connection', (socket) => {
    socket.on('join_room', ({ room, name, preference }) => {
        const roomUpper = room.toUpperCase();
        socket.join(roomUpper);
        
        if (!rooms[roomUpper]) {
            rooms[roomUpper] = { players: [], master: socket.id, started: false };
        }

        rooms[roomUpper].players.push({ id: socket.id, name, preference });

        io.to(roomUpper).emit('update_players', {
            players: rooms[roomUpper].players,
            master: rooms[roomUpper].master
        });
    });

    socket.on('start_game', (room) => {
        const r = rooms[room];
        if (r && r.master === socket.id && !r.started) {
            r.started = true;
            const assignedPlayers = assignRoles(r.players);
            r.players = assignedPlayers;

            // Invia i ruoli privatamente a ciascun socket id
            assignedPlayers.forEach(p => {
                let info = { compagni: [] };
                if (p.role === 'Lupo') {
                    info.compagni = assignedPlayers
                        .filter(ap => ap.role === 'Lupo' && ap.id !== p.id)
                        .map(ap => ap.name);
                }
                io.to(p.id).emit('role_assigned', { role: p.role, info: info });
            });
        }
    });

    socket.on('disconnect', () => {
        for (const room in rooms) {
            const index = rooms[room].players.findIndex(p => p.id === socket.id);
            if (index !== -1) {
                rooms[room].players.splice(index, 1);
                // Se il Master si disconnette, passa il comando al successivo
                if (rooms[room].master === socket.id && rooms[room].players.length > 0) {
                    rooms[room].master = rooms[room].players[0].id;
                }
                io.to(room).emit('update_players', {
                    players: rooms[room].players,
                    master: rooms[room].master
                });
                // Distruggi la stanza se vuota
                if (rooms[room].players.length === 0) delete rooms[room];
                break;
            }
        }
    });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`Server attivo sulla porta ${PORT}`));
