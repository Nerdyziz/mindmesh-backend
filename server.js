import { createServer } from "http";
import { Server } from "socket.io";
import dotenv from "dotenv";
import OpenAI from "openai";

/* -------------------- ENV SETUP -------------------- */
dotenv.config();

const PORT = process.env.PORT || 3001;
const CORS_ORIGIN = process.env.CORS_ORIGIN || "http://localhost:3000";

/* -------------------- AI CLIENT (GROQ) -------------------- */
const aiClient = new OpenAI({
  apiKey: process.env.API_KEY,
  baseURL: "https://api.groq.com/openai/v1",
});

/* -------------------- HTTP SERVER -------------------- */
const httpServer = createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("OK");
    return;
  }

  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("MindMesh Socket Server Running");
});

/* -------------------- SOCKET.IO -------------------- */
const io = new Server(httpServer, {
  cors: {
    origin: CORS_ORIGIN,
    methods: ["GET", "POST"],
  },
});

/*
rooms = {
  roomId: {
    users: Map<username, socketId>,
    messages: [{ sender, text }],
    leaveTimers: Map<username, timeout>
  }
}
*/
const rooms = new Map();

/* -------------------- SOCKET EVENTS -------------------- */
io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  /* -------- CREATE ROOM -------- */
  socket.on("create-room", ({ roomid }) => {
    if (rooms.has(roomid)) return;

    rooms.set(roomid, {
      users: new Map(),
      messages: [],
      leaveTimers: new Map(),
    });

    socket.emit("room-created");
  });

  /* -------- JOIN ROOM -------- */
  socket.on("join-room", ({ roomid, username }) => {
    if (!rooms.has(roomid)) {
      socket.emit("room-not-found");
      return;
    }

    const room = rooms.get(roomid);
    const isRejoin = room.leaveTimers.has(username);

    if (isRejoin) {
      clearTimeout(room.leaveTimers.get(username));
      room.leaveTimers.delete(username);
    }

    socket.join(roomid);

    room.users.set(username, socket.id);
    socket.data.roomid = roomid;
    socket.data.username = username;

    socket.emit("room-history", room.messages);

    if (!isRejoin) {
      socket.to(roomid).emit("receive-message", {
        sender: "System",
        text: `${username} joined the room`,
      });
    }

    console.log(`User ${username} joined room ${roomid}`);
  });

  /* -------- SEND MESSAGE -------- */
  socket.on("send-message", async ({ roomid, sender, text }) => {
    if (!rooms.has(roomid)) return;

    const room = rooms.get(roomid);
    const message = { sender, text };

    room.messages.push(message);
    if (room.messages.length > 20) room.messages.shift();

    io.to(roomid).emit("receive-message", message);

    /* -------- AI TRIGGER -------- */
    if (!text.toLowerCase().includes("@ai")) return;

    try {
      const historyText = room.messages
        .map((m) => `${m.sender}: ${m.text}`)
        .join("\n");

      const prompt = `
You are an AI assistant inside an anonymous group chat.
Be concise, friendly, and helpful.

Conversation:
${historyText}

Question:
${text.replace("@ai", "").trim()}
      `;

      const response = await aiClient.responses.create({
        model: "openai/gpt-oss-20b",
        input: prompt,
      });

      const aiReply =
        response.output_text ||
        "⚠️ AI did not return a response.";

      const aiMessage = { sender: "AI 🤖", text: aiReply };

      room.messages.push(aiMessage);
      if (room.messages.length > 20) room.messages.shift();

      io.to(roomid).emit("receive-message", aiMessage);
    } catch (error) {
      console.error("AI error:", error);
      io.to(roomid).emit("receive-message", {
        sender: "AI 🤖",
        text: "⚠️ AI is temporarily unavailable.",
      });
    }
  });

  /* -------- DISCONNECT -------- */
  socket.on("disconnecting", () => {
    const { roomid, username } = socket.data;
    if (!roomid || !username || !rooms.has(roomid)) return;

    const room = rooms.get(roomid);

    const timer = setTimeout(() => {
      room.users.delete(username);
      room.leaveTimers.delete(username);

      io.to(roomid).emit("receive-message", {
        sender: "System",
        text: `${username} left the room`,
      });

      if (room.users.size === 0) {
        rooms.delete(roomid);
        console.log(`Room ${roomid} deleted`);
      }
    }, 5000);

    room.leaveTimers.set(username, timer);
  });
});

/* -------------------- START SERVER -------------------- */
httpServer.listen(PORT, () => {
  console.log(`🚀 MindMesh Socket.IO server running on port ${PORT}`);
});
