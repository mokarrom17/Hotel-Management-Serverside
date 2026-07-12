const express = require("express");
const cors = require("cors");
const app = express();

const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

require("dotenv").config();

const port = process.env.PORT || 5000;

// Firebase Admin SDK
const { initializeApp, cert } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");

const serviceAccount = require("./hotel-management-firebase-adminsdk-.json");

initializeApp({
  credential: cert(serviceAccount),
});

// Middleware
app.use(cors());
app.use(express.json());

// Firebase Token Verify Middleware

const verifyFBToken = async (req, res, next) => {
  const token = req.headers.authorization;

  console.log("Header Token:", token);

  if (!token) {
    return res.status(401).send({
      message: "Unauthorized access",
    });
  }

  try {
    const idToken = token.split(" ")[1];

    const decoded = await getAuth().verifyIdToken(idToken);

    req.decoded_email = decoded.email;

    console.log("Verified User:", req.decoded_email);

    next();
  } catch (error) {
    console.log(error);

    return res.status(403).send({
      message: "Forbidden access",
    });
  }
};

const uri = `mongodb+srv://${process.env.HM_USER}:${process.env.HM_PASS}@cluster0.olgdgso.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    await client.connect();

    const userCollection = client.db("HotelDb").collection("users");

    const serviceCollection = client.db("HotelDb").collection("roomTypes");

    const bookingCollection = client.db("HotelDb").collection("bookings");

    // =========================
    // Rooms
    // =========================

    app.get("/roomTypes", async (req, res) => {
      const result = await serviceCollection.find().toArray();

      res.send(result);
    });

    // Single Room

    app.get("/roomTypes/:id", async (req, res) => {
      const id = req.params.id;

      const result = await serviceCollection.findOne({
        _id: new ObjectId(id),
      });

      res.send(result);
    });

    // =========================
    // Users
    // =========================

    app.post("/users", async (req, res) => {
      try {
        const user = req.body;

        const existingUser = await userCollection.findOne({
          email: user.email,
        });

        if (existingUser) {
          return res.send({
            message: "User already exists",
          });
        }

        const result = await userCollection.insertOne(user);

        res.send(result);
      } catch (error) {
        res.status(500).send({
          message: "Server Error",
        });
      }
    });

    // =========================
    // Create Booking
    // Protected
    // =========================

    app.post("/bookings", verifyFBToken, async (req, res) => {
      const booking = req.body;

      console.log("Booking email:", booking.customerEmail);

      console.log("Token email:", req.decoded_email);

      if (booking.customerEmail !== req.decoded_email) {
        return res.status(403).send({
          message: "Forbidden",
        });
      }

      const result = await bookingCollection.insertOne(booking);

      res.send(result);
    });

    // =========================
    // Get User Bookings
    // Protected
    // =========================

    app.get("/bookings", verifyFBToken, async (req, res) => {
      const email = req.query.email;

      if (email !== req.decoded_email) {
        return res.status(403).send({
          message: "Forbidden access",
        });
      }

      const result = await bookingCollection
        .find({
          customerEmail: email,
        })
        .toArray();

      res.send(result);
    });

    await client.db("admin").command({ ping: 1 });

    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!",
    );
  } finally {
    // await client.close();
  }
}

run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Hotel is running");
});

app.listen(port, () => {
  console.log(`Hotel is running on port ${port}`);
});
