const express = require("express");
const cors = require("cors");
const app = express();

const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

require("dotenv").config();

const stripe = require("stripe")(process.env.STRIPE_SECRET);

const port = process.env.PORT || 5000;

// Firebase Admin SDK
const { initializeApp, cert } = require("firebase-admin/app");
const { getAuth, TenantAwareAuth } = require("firebase-admin/auth");

const serviceAccount = require("./hotel-management-firebase-adminsdk-.json");

initializeApp({
  credential: cert(serviceAccount),
});

// Middleware
app.use(cors());
app.use(express.json());

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

    const roomCollection = client.db("HotelDb").collection("rooms");

    const bookingCollection = client.db("HotelDb").collection("bookings");

    const paymentCollection = client.db("HotelDb").collection("payments");

    // Firebase Token Verify Middleware
    const verifyFBToken = async (req, res, next) => {
      const token = req.headers.authorization;

      // console.log("Header Token:", token);

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

    // =========================
    // Verify Admin Middleware
    // =========================

    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded_email;

      const user = await userCollection.findOne({ email });

      if (!user || user.role !== "admin") {
        return res
          .status(403)
          .send({ message: "Forbidden access - Admin only" });
      }
      next();
    };

    // =========================
    // Rooms Types
    // =========================

    app.get("/roomTypes", async (req, res) => {
      const result = await serviceCollection.find().toArray();

      res.send(result);
    });

    // single Room

    app.get("/roomTypes/:id", async (req, res) => {
      const id = req.params.id;

      const result = await serviceCollection.findOne({
        _id: new ObjectId(id),
      });

      res.send(result);
    });

    // =========================
    // Get All Rooms
    // Search + Filter
    // =========================

    app.get("/rooms", async (req, res) => {
      try {
        const { search, roomType, floor, status } = req.query;

        const query = {};

        // Search by Room Number
        if (search) {
          query.roomNumber = {
            $regex: search,
            $options: "i",
          };
        }

        // Filter by Room Type
        if (roomType) {
          query.roomTypeName = roomType;
        }

        // Filter by Floor
        if (floor) {
          query.floor = Number(floor);
        }

        // Filter by Availability
        if (status === "available") {
          query.isAvailable = true;
        }

        if (status === "booked") {
          query.isAvailable = false;
        }

        // Filter by Maintenance
        if (status === "maintenance") {
          query.maintenanceStatus = {
            $ne: "good",
          };
        }

        const result = await roomCollection.find(query).toArray();

        res.send(result);
      } catch (error) {
        console.error(error);
        res.status(500).send({
          message: "Failed to fetch rooms",
        });
      }
    });
    // Room Statistics

    app.get("/rooms/stats", async (req, res) => {
      try {
        const totalRooms = await roomCollection.countDocuments();
        const availableRooms = await roomCollection.countDocuments({
          isAvailable: true,
        });

        const bookedRooms = await roomCollection.countDocuments({
          isAvailable: false,
        });

        const maintenanceRooms = await roomCollection.countDocuments({
          maintenanceStatus: {
            $ne: "good",
          },
        });
        res.send({
          totalRooms,
          availableRooms,
          bookedRooms,
          maintenanceRooms,
        });
      } catch (error) {
        console.log(error);
        res.status(500).send({
          message: "Failed to load room statistics",
        });
      }
    });

    // =========================
    // Room Availability Summary (by room type)
    // Public — used on the public RoomDetails page so guests
    // can see how many rooms of a type are free, and on which
    // floors / views, before they start a booking.
    // =========================
    app.get("/rooms/availability", async (req, res) => {
      try {
        const { roomType } = req.query;

        if (!roomType) {
          return res.status(400).send({
            message: "roomType query parameter is required",
          });
        }

        const availableRooms = await roomCollection
          .find({ roomTypeName: roomType, isAvailable: true })
          .toArray();

        const floors = [
          ...new Set(availableRooms.map((r) => r.floor).filter(Boolean)),
        ].sort((a, b) => a - b);

        const views = [
          ...new Set(availableRooms.map((r) => r.view).filter(Boolean)),
        ];

        res.send({
          availableCount: availableRooms.length,
          floors,
          views,
        });
      } catch (error) {
        console.error(error);
        res.status(500).send({
          message: "Failed to load room availability",
        });
      }
    });

    // =========================
    // Get Available Rooms By Type
    // Public
    // =========================
    app.get("/rooms/available", async (req, res) => {
      try {
        const { roomType } = req.query;

        if (!roomType) {
          return res.status(400).send({
            message: "roomType is required",
          });
        }

        const rooms = await roomCollection
          .find({
            roomTypeName: roomType,
            isAvailable: true,
          })
          .project({
            roomNumber: 1,
            floor: 1,
            view: 1,
            maintenanceStatus: 1,
          })
          .sort({ roomNumber: 1 })
          .toArray();

        res.send(rooms);
      } catch (error) {
        console.log(error);
        res.status(500).send({
          message: "Failed to load available rooms",
        });
      }
    });

    // Single Room
    app.get("/rooms/:id", async (req, res) => {
      const id = req.params.id;

      const result = await roomCollection.findOne({
        _id: new ObjectId(id),
      });
      res.send(result);
    });
    // =========================
    // Users
    // =========================

    app.get("/users", async (req, res) => {
      const cursor = userCollection.find();
      const result = await cursor.toArray();
      res.send(result);
    });

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

    app.patch("/users/:id", async (req, res) => {
      const id = req.params.id;
      const updateData = req.body;

      const query = {
        _id: new ObjectId(id),
      };

      const updateDoc = {
        $set: updateData,
      };

      const result = await userCollection.updateOne(query, updateDoc);

      res.send(result);
    });

    // =========================
    // Create Booking
    // Protected
    // =========================

    app.post("/bookings", verifyFBToken, async (req, res) => {
      const booking = req.body;

      booking.createdAt = new Date().toISOString();

      booking.paymentStatus = booking.paymentStatus || "pending";
      booking.bookingStatus = booking.bookingStatus || "pending";

      if (booking.customerEmail !== req.decoded_email) {
        return res.status(403).send({
          message: "Forbidden",
        });
      }

      const result = await bookingCollection.insertOne(booking);

      res.send(result);
    });

    // =========================
    // Get All Bookings (Admin)
    // Protected
    // =========================

    app.get("/admin/bookings", async (req, res) => {
      try {
        const bookings = await bookingCollection
          .find()
          .sort({ createdAt: -1 })
          .toArray();
        res.send(bookings);
      } catch (error) {
        console.log(error);

        res.status(500).send({ message: "Failed to fetch bookings" });
      }
    });

    // Confirm booking
    app.patch(
      "/admin/bookings/:id/confirm",
      verifyFBToken,
      verifyAdmin,
      async (req, res) => {
        const { id } = req.params;

        const booking = await bookingCollection.findOne({
          _id: new ObjectId(id),
        });

        if (!booking) {
          return res.status(404).send({
            message: "Booking not found",
          });
        }

        if (
          booking.bookingStatus === "confirmed" ||
          booking.bookingStatus === "checked-in" ||
          booking.bookingStatus === "checked-out"
        ) {
          return res.status(400).send({
            message: "Booking is already confirmed.",
          });
        }

        if (booking.bookingStatus === "cancelled") {
          return res.status(400).send({
            message: "Cancelled booking cannot be confirmed.",
          });
        }

        const result = await bookingCollection.updateOne(
          {
            _id: new ObjectId(id),
          },
          {
            $set: {
              bookingStatus: "confirmed",
              confirmedAt: new Date().toISOString(),
            },
          },
        );

        res.send(result);
      },
    );
    // Cancel booking
    app.patch(
      "/admin/bookings/:id/cancel",
      verifyFBToken,
      verifyAdmin,
      async (req, res) => {
        const { id } = req.params;

        if (!ObjectId.isValid(id)) {
          return res.status(400).send({
            message: "Invalid booking ID",
          });
        }

        const booking = await bookingCollection.findOne({
          _id: new ObjectId(id),
        });

        if (!booking) {
          return res.status(404).send({
            message: "Booking not found",
          });
        }

        // Already cancelled
        if (booking.bookingStatus === "cancelled") {
          return res.status(400).send({
            message: "Booking is already cancelled.",
          });
        }

        // Checked-in / Checked-out bookings cannot be cancelled
        if (
          booking.bookingStatus === "checked-in" ||
          booking.bookingStatus === "checked-out"
        ) {
          return res.status(400).send({
            message: "Checked-in or checked-out bookings cannot be cancelled.",
          });
        }

        const result = await bookingCollection.updateOne(
          {
            _id: new ObjectId(id),
          },
          {
            $set: {
              bookingStatus: "cancelled",
              cancelledAt: new Date().toISOString(),
            },
          },
        );

        res.send(result);
      },
    );
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

    // =========================
    // Check If User Is Admin
    // Protected — user can only check their own role
    // =========================
    app.get("/users/admin/:email", verifyFBToken, async (req, res) => {
      const email = req.params.email;

      if (email !== req.decoded_email) {
        return res.status(403).send({ message: "Forbidden access" });
      }

      const user = await userCollection.findOne({ email });

      let admin = false;

      if (user) {
        admin = user?.role === "admin";
      }
      res.send({ admin });
    });

    // =========================
    // Get Single Booking
    // Protected
    // =========================

    app.get("/bookings/:id", verifyFBToken, async (req, res) => {
      const id = req.params.id;

      const booking = await bookingCollection.findOne({
        _id: new ObjectId(id),
      });

      if (!booking) {
        return res.status(404).send({ message: "Booking Not Found" });
      }

      if (booking.customerEmail !== req.decoded_email) {
        return res.status(403).send({ message: "Forbidden access" });
      }

      res.send(booking);
    });

    // =========================
    // Create Stripe Payment Intent
    // Protected
    // =========================

    app.post("/create-payment-intent", verifyFBToken, async (req, res) => {
      try {
        const { price } = req.body;

        const amount = Math.round(price * 100);

        const paymentIntent = await stripe.paymentIntents.create({
          amount,
          currency: "usd",
          payment_method_types: ["card"],
        });

        res.send({ clientSecret: paymentIntent.client_secret });
      } catch (error) {
        res.status(500).send({ message: "Failed to create payment intent" });
      }
    });

    // =========================
    // Confirm Payment — mark booking as paid
    // Protected
    // =========================

    app.patch("/bookings/:id/pay", verifyFBToken, async (req, res) => {
      const id = req.params.id;

      const { transactionId } = req.body;

      const booking = await bookingCollection.findOne({
        _id: new ObjectId(id),
      });

      if (!booking) {
        return res.status(404).send({ message: "Booking not found" });
      }

      if (booking.customerEmail !== req.decoded_email) {
        return res.status(403).send({ message: "Forbidden access" });
      }

      const updateResult = await bookingCollection.updateOne(
        { _id: new ObjectId(id) },
        {
          $set: {
            paymentStatus: "paid",
            transactionId,
            paidAt: new Date(),
          },
        },
      );

      await paymentCollection.insertOne({
        bookingId: id,
        email: booking.customerEmail,
        amount: booking.totalPrice,
        transactionId,
        paidAt: new Date(),
      });

      res.send(updateResult);
    });

    // =========================
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
