const express = require("express");
const cors = require("cors");
const app = express();

const {
  MongoClient,
  ServerApiVersion,
  ObjectId,
  CommandSucceededEvent,
} = require("mongodb");

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

    const employeeApplicationCollection = client
      .db("HotelDb")
      .collection("employeeApplications");

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

    app.get("/users", verifyFBToken, async (req, res) => {
      const cursor = userCollection.find();
      const result = await cursor.toArray();
      res.send(result);
    });

    // =========================
    // Create User
    // Protected
    // =========================
    app.post("/users", verifyFBToken, async (req, res) => {
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
        console.error("User creation error: ", error);
        res.status(500).send({
          message: "Server Error",
        });
      }
    });

    // =========================
    // Employee Application
    // Protected
    // =========================

    app.post("/employee-applications", verifyFBToken, async (req, res) => {
      try {
        const application = req.body;
        const userEmail = req.decoded_email;

        const existingApplication = await employeeApplicationCollection.findOne(
          {
            email: userEmail,
            status: "pending",
          },
        );

        if (existingApplication) {
          return res.status(400).send({
            message: "You already have a pending application",
          });
        }

        const applicationData = {
          name: application.name,
          email: userEmail,
          phone: application.phone,
          dateOfBirth: application.dateOfBirth,
          address: application.address,
          position: application.position,
          experience: application.experience,
          skills: application.skills,
          reason: application.reason,
          status: "pending",
          createdAt: new Date(),
        };

        const result =
          await employeeApplicationCollection.insertOne(applicationData);

        res.send({
          success: true,
          message: "Application submitted successfully.",
          insertedId: result.insertedId,
        });
      } catch (error) {
        console.error("Employee application error: ", error);

        res.status(500).send({
          message: "Failed to submit employee application.",
        });
      }
    });
    // =========================
    // Get All Employee Applications
    // Protected
    // =========================
    app.get(
      "/admin/manage-employees",
      verifyFBToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const applications = await employeeApplicationCollection
            .find()
            .sort({ createdAt: -1 })
            .toArray();

          res.send(applications);
        } catch (error) {
          console.error("Get employee applications error: ", error);

          res.status(500).send({
            message: "Failed to fetch employee applications.",
          });
        }
      },
    );

    // =========================
    // Update User Role
    // Protected
    // =========================
    app.patch("/users/:id", verifyFBToken, async (req, res) => {
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

    app.get("/admin/bookings", verifyFBToken, verifyAdmin, async (req, res) => {
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

    // =========================
    // Admin Dashboard Statistics
    // Protected
    // =========================

    app.get(
      "/admin/dashboard-stats",
      verifyFBToken,
      verifyAdmin,
      async (req, res) => {
        try {
          // Users
          const totalUsers = await userCollection.countDocuments();
          const totalAdmins = await userCollection.countDocuments({
            role: "admin",
          });
          const totalStaff = await userCollection.countDocuments({
            role: "staff",
          });
          const totalCustomers = await userCollection.countDocuments({
            role: "customer",
          });

          // Rooms
          const totalRooms = await roomCollection.countDocuments();

          const availableRooms = await roomCollection.countDocuments({
            isAvailable: true,
          });

          const bookedRooms = await roomCollection.countDocuments({
            isAvailable: false,
          });

          const maintenanceRooms = await roomCollection.countDocuments({
            maintenanceStatus: "maintenance",
          });

          // Bookings
          const totalBookings = await bookingCollection.countDocuments();

          const pendingBookings = await bookingCollection.countDocuments({
            bookingStatus: "pending",
          });

          const confirmedBookings = await bookingCollection.countDocuments({
            bookingStatus: "confirmed",
          });

          const checkedIn = await bookingCollection.countDocuments({
            bookingStatus: "checked-in",
          });

          const checkedOut = await bookingCollection.countDocuments({
            bookingStatus: "checked-out",
          });

          const cancelledBookings = await bookingCollection.countDocuments({
            bookingStatus: "cancelled",
          });

          // Payments
          const paidBookings = await bookingCollection.countDocuments({
            paymentStatus: "paid",
          });

          const pendingPayments = await bookingCollection.countDocuments({
            paymentStatus: "pending",
          });

          const failedPayments = await bookingCollection.countDocuments({
            paymentStatus: "failed",
          });

          // Revenue
          const revenue = await bookingCollection
            .aggregate([
              {
                $match: {
                  paymentStatus: "paid",
                },
              },
              {
                $group: {
                  _id: null,
                  totalRevenue: {
                    $sum: "$totalPrice",
                  },
                },
              },
            ])
            .toArray();

          const totalRevenue = revenue[0]?.totalRevenue || 0;

          res.send({
            totalUsers,
            totalAdmins,
            totalStaff,
            totalCustomers,

            totalRooms,
            availableRooms,
            bookedRooms,
            maintenanceRooms,

            totalBookings,
            pendingBookings,
            confirmedBookings,
            checkedIn,
            checkedOut,
            cancelledBookings,

            paidBookings,
            pendingPayments,
            failedPayments,

            totalRevenue,
          });
        } catch (error) {
          res.status(500).send({
            message: "Failed to load dashboard statistics.",
          });
        }
      },
    );
    // ==========================
    // Today's Summary
    // Protected
    // ==========================
    app.get(
      "/admin/today-summary",
      verifyFBToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const today = new Date();

          const startOfDay = new Date(today);
          startOfDay.setHours(0, 0, 0, 0);

          const endOfDay = new Date(today);
          endOfDay.setHours(23, 59, 59, 999);

          const todayString = today.toISOString().split("T")[0];

          const todayBookings = await bookingCollection.countDocuments({
            createdAt: {
              $gte: startOfDay.toISOString(),
              $lte: endOfDay.toISOString(),
            },
          });

          const revenue = await bookingCollection
            .aggregate([
              {
                $match: {
                  paymentStatus: "paid",
                  paidAt: {
                    $gte: startOfDay,
                    $lte: endOfDay,
                  },
                },
              },
              {
                $group: {
                  _id: null,
                  todayRevenue: {
                    $sum: "$totalPrice",
                  },
                },
              },
            ])
            .toArray();

          const todayRevenue = revenue[0]?.todayRevenue || 0;

          const todayCheckIns = await bookingCollection.countDocuments({
            checkIn: todayString,
          });

          const todayCheckOuts = await bookingCollection.countDocuments({
            checkOut: todayString,
          });

          res.send({
            todayRevenue,
            todayBookings,
            todayCheckIns,
            todayCheckOuts,
          });
        } catch (error) {
          console.log(error);

          res.status(500).send({
            message: "Failed to load today's summary.",
          });
        }
      },
    );

    // =========================
    // Revenue Chart Data
    // Protected
    // =========================

    app.get(
      "/admin/revenue-chart",
      verifyFBToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const revenue = await bookingCollection
            .aggregate([
              {
                $match: {
                  paymentStatus: "paid",
                },
              },
              {
                $group: {
                  _id: {
                    month: {
                      $month: {
                        $toDate: "$createdAt",
                      },
                    },
                  },
                  revenue: {
                    $sum: "$totalPrice",
                  },
                },
              },
              {
                $sort: {
                  "_id.month": 1,
                },
              },
            ])
            .toArray();

          const monthNames = [
            "",
            "Jan",
            "Feb",
            "Mar",
            "Apr",
            "May",
            "Jun",
            "Jul",
            "Aug",
            "Sep",
            "Oct",
            "Nov",
            "Dec",
          ];

          const formatted = revenue.map((item) => ({
            month: monthNames[item._id.month],
            revenue: item.revenue,
          }));

          res.send(formatted);
        } catch (error) {
          console.log(error);
          res.status(500).send({
            message: "Failed to load revenue chart.",
          });
        }
      },
    );
    // =========================
    // Booking Trend Chart Data
    // Protected
    // =========================
    app.get(
      "/admin/booking-trend",
      verifyFBToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const bookings = await bookingCollection
            .aggregate([
              {
                $addFields: {
                  bookingDate: {
                    $toDate: "$createdAt",
                  },
                },
              },
              {
                $group: {
                  _id: {
                    month: {
                      $month: "$bookingDate",
                    },
                  },
                  bookings: {
                    $sum: 1,
                  },
                },
              },
              {
                $sort: {
                  "_id.month": 1,
                },
              },
            ])
            .toArray();

          const months = [
            "",
            "Jan",
            "Feb",
            "Mar",
            "Apr",
            "May",
            "Jun",
            "Jul",
            "Aug",
            "Sep",
            "Oct",
            "Nov",
            "Dec",
          ];

          const formatted = bookings.map((item) => ({
            month: months[item._id.month],
            bookings: item.bookings,
          }));

          res.send(formatted);
        } catch (error) {
          console.log(error);

          res.status(500).send({
            message: "Failed to load booking trend.",
          });
        }
      },
    );

    // =========================
    // Occupancy Rate
    // Protected
    // =========================

    app.get(
      "/admin/occupancy",
      verifyFBToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const totalRooms = await roomCollection.countDocuments();

          const availableRooms = await roomCollection.countDocuments({
            isAvailable: true,
          });

          const bookedRooms = await roomCollection.countDocuments({
            isAvailable: false,
          });

          const maintenanceRooms = await roomCollection.countDocuments({
            maintenanceStatus: "maintenance",
          });

          const occupancyRate =
            totalRooms === 0
              ? 0
              : Number(((bookedRooms / totalRooms) * 100).toFixed(1));

          res.send({
            totalRooms,
            availableRooms,
            bookedRooms,
            maintenanceRooms,
            occupancyRate,
          });
        } catch (error) {
          console.log(error);

          res.status(500).send({
            message: "Failed to load occupancy.",
          });
        }
      },
    );

    // =========================
    // Recent Bookings
    // Protected
    // =========================

    app.get(
      "/admin/recent-bookings",
      verifyFBToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const recentBookings = await bookingCollection
            .find({})
            .sort({ createdAt: -1 })
            .limit(5)
            .toArray();

          res.send(recentBookings);
        } catch (error) {
          console.log(error);

          res.status(500).send({
            message: "Failed to load recent bookings.",
          });
        }
      },
    );

    // ===================================
    // Confirm booking
    // ===================================
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
    // ===================================
    // Cancel booking
    // ===================================
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
    // =====================================
    // Check-In booking
    // =====================================
    app.patch(
      "/admin/bookings/:id/check-in",
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

        // Only confirmed bookings can be checked in
        if (booking.bookingStatus !== "confirmed") {
          return res.status(400).send({
            message: "Only confirmed bookings can be checked in.",
          });
        }

        const result = await bookingCollection.updateOne(
          {
            _id: new ObjectId(id),
          },
          {
            $set: {
              bookingStatus: "checked-in",
              checkedInAt: new Date().toISOString(),
            },
          },
        );

        res.send(result);
      },
    );
    // ====================================
    // Check-Out booking
    // ====================================
    app.patch(
      "/admin/bookings/:id/check-out",
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

        // Only checked-in bookings can be checked out
        if (booking.bookingStatus !== "checked-in") {
          return res.status(400).send({
            message: "Only checked-in bookings can be checked out.",
          });
        }

        const result = await bookingCollection.updateOne(
          {
            _id: new ObjectId(id),
          },
          {
            $set: {
              bookingStatus: "checked-out",
              checkedOutAt: new Date().toISOString(),
            },
          },
        );

        res.send(result);
      },
    );

    // =========================
    // Cancel Booking
    // Protected
    // =========================
    app.patch(
      "/bookings/:id/cancel",
      verifyFBToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const { id } = req.params;
          const userEmail = req.decoded_email;

          const booking = await bookingCollection.findOne({
            _id: new ObjectId(id),
          });

          // Booking not found
          if (!booking) {
            return res.status(404).send({
              message: "Booking not found",
            });
          }

          // check booking ownership
          if (booking.customerEmail !== userEmail) {
            return res.status(403).send({
              message: "You can only cancel your own booking",
            });
          }

          // Already cancelled
          if (booking.bookingStatus === "cancelled") {
            return res.status(400).send({
              message: "Booking is already cancelled",
            });
          }

          // Already checked in
          if (booking.bookingStatus === "checked-in") {
            return res.status(400).send({
              message: "Checked-in booking cannot be cancelled",
            });
          }

          // Already Completed
          if (booking.bookingStatus === "checked-out") {
            return res.status(400).send({
              message: "Complete booking cannot be cancelled",
            });
          }

          const result = await bookingCollection.updateOne(
            {
              _id: new ObjectId(id),
              customerEmail: userEmail,
            },

            {
              $set: {
                bookingStatus: "cancelled",
                cancelledAt: new Date().toISOString(),
              },
            },
          );
          res.send({
            message: "Booking cancelled successfully.",
            result,
          });
        } catch (error) {
          console.error("Cancel booking error : ", error);

          res.status(500).send({
            message: "Failed to cancel booking.",
          });
        }
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
    // Get User Role
    // =========================
    app.get("/users/role/:email", verifyFBToken, async (req, res) => {
      const email = req.params.email;

      if (email !== req.decoded_email) {
        return res.status(403).send({ message: "Forbidden access" });
      }

      const user = await userCollection.findOne(
        { email },
        { projection: { role: 1 } },
      );

      if (!user) {
        return res.status(404).send({ message: "User not found" });
      }

      res.send({
        role: user.role || "customer",
      });
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
    // User Dashboard Statistics
    // Protected
    // =========================
    app.get("/user/dashboard-stats", verifyFBToken, async (req, res) => {
      try {
        const email = req.decoded_email;

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const bookings = await bookingCollection
          .find({ customerEmail: email })
          .toArray();

        const totalBookings = bookings.length;

        const upcomingStays = bookings.filter((booking) => {
          const checkIn = new Date(booking.checkIn);
          checkIn.setHours(0, 0, 0, 0);

          return checkIn >= today && booking.bookingStatus !== "cancelled";
        }).length;

        const completedStays = bookings.filter((booking) => {
          const checkOut = new Date(booking.checkOut);
          checkOut.setHours(0, 0, 0, 0);

          return checkOut < today && booking.bookingStatus !== "cancelled";
        }).length;

        const totalSpent = bookings
          .filter((booking) => booking.paymentStatus === "paid")
          .reduce((total, booking) => {
            return total + Number(booking.totalPrice || 0);
          }, 0);

        res.send({
          totalBookings,
          upcomingStays,
          completedStays,
          totalSpent,
        });
      } catch (error) {
        console.error("User dashboard stats error:", error);

        res.status(500).send({
          message: "Failed to load dashboard statistics.",
        });
      }
    });

    // =========================
    // Upcoming Booking
    // Protected
    // =========================
    app.get("/user/upcoming-booking", verifyFBToken, async (req, res) => {
      try {
        const email = req.decoded_email;

        const today = new Date().toISOString().split("T")[0];

        const upcomingBooking = await bookingCollection
          .find({
            customerEmail: email,
            checkIn: { $gte: today },
            bookingStatus: { $ne: "cancelled" },
          })
          .sort({ checkIn: 1 })
          .limit(1)
          .toArray();

        if (upcomingBooking.length === 0) {
          return res.send(null);
        }
        res.send(upcomingBooking[0]);
      } catch (error) {
        console.error("Upcoming booking error:", error);

        res.status(500).send({
          message: "Failed to load upcoming booking",
        });
      }
    });
    // =====================
    // Recent Bookings
    // =====================

    app.get("/user/recent-bookings", verifyFBToken, async (req, res) => {
      try {
        const email = req.decoded_email;

        const recentBookings = await bookingCollection
          .find({
            customerEmail: email,
          })
          .sort({ createdAt: 1 })
          .limit(5)
          .toArray();

        res.send(recentBookings);
      } catch (error) {
        console.error("Recent bookings error:", error);

        res.status(500).send({
          message: "Failed to load recent bookings.",
        });
      }
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
