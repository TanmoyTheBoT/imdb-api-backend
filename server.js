require("dotenv").config();
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const mysql = require("mysql2/promise");
const nodemailer = require("nodemailer");
const crypto = require("crypto");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

// Create HTTP server and attach Socket.io
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.CORS_ORIGIN || "*", // Adjust for production: set your frontend domain
    methods: ["GET", "POST"]
  }
});

// Create a MySQL connection pool using your Aiven MySQL credentials
const pool = mysql.createPool({
  host: process.env.MYSQL_HOST,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
  port: process.env.MYSQL_PORT || 3306,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,

});

// Configure Nodemailer with Gmail SMTP (using an App Password)
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,   // your Gmail address
    pass: process.env.EMAIL_PASS    // your Gmail App Password
  }
});

// Socket.io connection: Listen for clients
io.on("connection", (socket) => {
  console.log("Client connected: " + socket.id);

  // Listen for "register" event from client
  socket.on("register", async (data) => {
    const { firstName, lastName, email } = data;
    
    // Basic validation
    if (!firstName || !lastName || !email) {
      socket.emit("registrationResponse", { 
        status: "error", 
        message: "All fields are required." 
      });
      return;
    }

    try {
      // Check if email already exists
      const [rows] = await pool.execute(
        "SELECT api_key FROM users WHERE email = ?", [email]
      );

      if (rows.length > 0) {
        socket.emit("registrationResponse", { 
          status: "error", 
          message: "Email already registered. Please check your email for your API key." 
        });
        return;
      }

      // Generate a secure API key
      const apiKey = crypto.randomBytes(16).toString("hex");

      // Insert the new user into the database
      await pool.execute(
        "INSERT INTO users (first_name, last_name, email, api_key) VALUES (?, ?, ?, ?)",
        [firstName, lastName, email, apiKey]
      );

      // Send the API key via email
      await transporter.sendMail({
        from: process.env.EMAIL_USER,
        to: email,
        subject: "Your FMDb API Key",
        html: `
          <p>Hello <strong>${firstName}</strong>,</p>
          <p>Your <strong>API key</strong> is: <code>${apiKey}</code></p>
          <p><strong>Keep it secure and do not share it.</strong></p>
          <p>To use it, append it to all your API requests:</p>
          https://fmdbapi.vercel.app/?i=tt0111161&apikey=${apiKey}

          <p>Best regards,<br><strong>The FMDb Team</strong></p>
        `
      });      

      // Emit success response back to the client
      socket.emit("registrationResponse", {
        status: "success",
        message: "API key generated and sent to your email!"
      });
    } catch (error) {
      console.error("Registration error:", error);
      socket.emit("registrationResponse", {
        status: "error",
        message: "Server error. Please try again later."
      });
    }
  });

  // Log client disconnect
  socket.on("disconnect", () => {
    console.log("Client disconnected: " + socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Socket.io server running on port ${PORT}`);
});
