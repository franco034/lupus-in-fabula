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
    
    // 1. CALCOLO DEI POSTI DISPONIBILI
    const numLupi = Math.max(1, Math.floor(count / 4));
    const numVeggente = count > 7 ? 1 : 0; 
    const numProtettore = count > 4 ? 1 : 0;
    const numProstituta = count > 4 ? 1 : 0;
    const numGiullare = count > 5 ? 1 : 0;
    
    const numContadini = Math.max(0, count - numLupi - numVeggente - numProtettore - numProstituta - numGiullare);

    // Mappa per gestire le preferenze in modo più pulito
    const roleCounts = {
        'Lupo': numLupi,
        'Veggente': numVeggente,
        'Protettore': numProtettore,
        'Prostituta': numProstituta,
        'Giullare': numGiullare
    };

    // 2. CREAZIONE DEL POOL DEI RUOLI
    let rolesPool = [];
    for(let i = 0; i < numLupi; i++) rolesPool.push('Lupo');
    for(let i = 0; i < numVeggente; i++) rolesPool.push('Veggente');
    for(let i = 0; i < numProtettore; i++) rolesPool.push('Protettore');
    for(let i = 0; i < numProstituta; i++) rolesPool.push('Prostituta');
    for(let i = 0; i < numGiullare; i++) rolesPool.push('Giullare');
    for(let i = 0; i < numContadini; i++) rolesPool.push('Contadino');

    let assigned = [];
    let remainingPlayers = [...players];

    // 3. ASSEGNAZIONE IN BASE ALLE PREFERENZE
    ['Lupo', 'Veggente', 'Protettore', 'Prostituta', 'Giullare'].forEach(role => {
        let needed = roleCounts[role];
        let candidates = shuffle(remainingPlayers.filter(p => p.preference === role));

        while(needed > 0 && candidates.length > 0) {
            let p = candidates.pop();
            assigned.push({ ...p, role: role });
            remainingPlayers = remainingPlayers.filter(rp => rp.id !== p.id);
            rolesPool.splice(rolesPool.indexOf(role), 1);
            needed--;
        }
    });

    // 4. RIEMPIMENTO CASUALE PER CHI NON HA AVUTO IL RUOLO PREFERITO O HA MESSO "CASUALE"
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

    // NUOVO EVENTO: RESET DELLA PARTITA
    socket.on('reset_game', (room) => {
        const r = rooms[room];
        // Controlla che la stanza esista e che a premere il tasto sia il Master
        if (r && r.master === socket.id) {
            r.started = false;
            
            // Ripulisce i ruoli assegnati per sicurezza, mantenendo solo i dati base (id, nome, preferenza)
            r.players = r.players.map(p => ({ id: p.id, name: p.name, preference: p.preference }));
            
            // Avvisa tutti i dispositivi di tornare alla schermata della lobby
            io.to(room).emit('game_reset');
            
            // Rinfresca la lista dei giocatori
            io.to(room).emit('update_players', {
                players: r.players,
                master: r.master
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