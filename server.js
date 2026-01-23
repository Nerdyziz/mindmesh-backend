import { createServer } from "http";
import { Server } from "socket.io";
import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";

dotenv.config();


// ✅ Initialize Gemini (LATEST SDK)
const ai = new GoogleGenAI({
    apiKey: process.env.API_KEY,
});

const httpServer = createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("OK");
    return;
  }

  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("MindMesh Socket Server Running");
});


const io = new Server(httpServer, {
  cors: {
    origin: process.env.CORS_ORIGIN || "http://localhost:3000",
    methods: ["GET", "POST"],
  },
});

// In-memory room store
const rooms = new Map();
/*
rooms = {
  roomid: {
    users: number,
    messages: [{ sender, text }]
  }
}
*/

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);
  socket.on("create-room", ({ roomid }) => {
  if (rooms.has(roomid)) return;

  rooms.set(roomid, {
    users: new Map(),
    messages: [],
    leaveTimers: new Map(),
  });
  socket.emit("room-created");
});

  

 socket.on("join-room", ({ roomid, username }) => {
  

  if (!rooms.has(roomid)) {
  socket.emit("room-not-found");
  return;
}

   const room = rooms.get(roomid);
   if (room.leaveTimers.has(username)) {
    clearTimeout(room.leaveTimers.get(username));
    room.leaveTimers.delete(username);
  }

  socket.join(roomid);

 
 console.log(`User ${username} joined room ${roomid}`);

  const isRejoin = room.leaveTimers.has(username);

  // cancel pending leave
 

  room.users.set(username, socket.id);


  socket.data.roomid = roomid;
  socket.data.username = username;

socket.emit("room-history", room.messages);
 console.log("Total connections:", room.users.size);

// ✅ notify ONLY if truly new

  socket.to(roomid).emit("receive-message", {
    sender: "System",
    text: `${username} joined the room`,
  });
});

socket.on("send-message", async ({ roomid, sender, text }) => {
    if (!rooms.has(roomid)) return;

    const room = rooms.get(roomid);
    const message = { sender, text };

    room.messages.push(message);
    if (room.messages.length > 20) room.messages.shift();

    io.to(roomid).emit("receive-message", message);

    // 🤖 AI Trigger
    if (text.toLowerCase().includes("@ai")) {
      try {
        const historyText = room.messages
          .map((m) => `${m.sender}: ${m.text}`)
          .join("\n");

        const prompt = `
You are an AI assistant inside an anonymous group chat.
Be helpful, concise, and friendly.
Answer using the conversation context.

Conversation:
${historyText}

Question:
${text.replace("@ai", "").trim()}
        `;

        const response = await ai.models.generateContent({
          model: "gemini-3-flash-preview",
          contents: prompt,
        });

        const aiReply = response.text;
        room.messages.push({ sender: "AI 🤖", text: aiReply });

        io.to(roomid).emit("receive-message", {
          sender: "AI 🤖",
          text: aiReply,
        });
      } catch (error) {
        console.error("Gemini error:", error);
        io.to(roomid).emit("receive-message", {
          sender: "AI 🤖",
          text: "⚠️ AI is temporarily unavailable.",
        });
      }
  }
});
socket.on("disconnecting", () => {
  
  const { roomid, username } = socket.data;

  console.log(`User ${username} is leaving room ${roomid}`);
  if (!roomid || !rooms.has(roomid)) return;

  const room = rooms.get(roomid);

 

  const timer = setTimeout(() => {
    
  console.log(`User ${username} left room ${roomid}`);

  room.users.delete(username);
  room.leaveTimers.delete(username);

  io.to(roomid).emit("receive-message", {
    sender: "System",
    text: `${username} left the room`,
  });

  if (room.users.size === 0) {
    rooms.delete(roomid);
    console.log(`Room ${roomid} deleted`);
    socket.leave(roomid);
  }
}, 5000);



  room.leaveTimers.set(username, timer);
});






});



const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
  console.log(`Socket.IO server running on port ${PORT}`);
});
