const express = require("express");
const cors = require("cors");
const app = express();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
require("dotenv").config();
const port = process.env.PORT || 5000;

//middleware
app.use(cors());
app.use(express.json());

console.log(process.env.HM_USER);

const uri = `mongodb+srv://${process.env.HM_USER}:${process.env.HM_PASS}@cluster0.olgdgso.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    const serviceCollection = client.db("HotelDb").collection("features");

    app.get("/features", async (req, res) => {
      const cursor = serviceCollection.find();
      const result = await cursor.toArray();
      res.send(result);
    });

    app.get("/features/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const options = {
        // Include only the `title` and `imdb` fields in the returned document
        projection: {
          type: 1,
          adults: 1,
          child: 1,
          price: 1,
          image: 1,
          gallery: 1,
          description: 1,
          cancellationPolicy: 1,
          beds: 1,
          amenities: 1,
          checkInTime: 1,
          checkOutTime: 1,
          beds: 1,
        },
      };
      const result = await serviceCollection.findOne(query, options);
      res.send(result);
    });

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
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
