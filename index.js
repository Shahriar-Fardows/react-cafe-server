// Dependencies
const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
require("dotenv").config();

// Defining port
const port = process.env.PORT || 5000;

//Creating the express app
const app = express();

// Middlewares
app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "http://localhost:5174",
      "https://eleventh-assignment-b4b1e.web.app",
      "https://eleventh-assignment-b4b1e.firebaseapp.com",
    ],
    credentials: true,
  })
);
app.use(express.json());
app.use(cookieParser());

// My custom middlewares
const verifyToken = (req, res, next) => {
  const token = req.cookies?.token;
  if (!token) {
    return res.status(404).send({ message: "Unauthorized" });
  }

  jwt.verify(token, process.env.SECRET_KEY, async (err, decoded) => {
    if (err) {
      return res.status(404).send({ message: "Unauthorized" });
    }
    req.decoded = decoded;
    next();
  });
};

// Root route
app.get("/", (req, res) => {
  res.send("Restaurant server is running");
});

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.gadig.mongodb.net/?retryWrites=true&w=majority`;

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

    // Food collection
    const foodCollection = client
      .db("restaurantDB")
      .collection("foodCollection");

    const purchaseCollection = client
      .db("restaurantDB")
      .collection("purchaseCollection");

    const userCollection = client
      .db("restaurantDB")
      .collection("userCollection");

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );

    // Auth/Token related
    app.post("/jwt", (req, res) => {
      const user = req.body;

      const token = jwt.sign(user, process.env.SECRET_KEY, { expiresIn: "1h" });

      res
        .cookie("token", token, {
          httpOnly: true,
          secure: true,
          sameSite: "none",
        })
        .send({ success: true });
    });

    // Clear token from cookie after logout
    app.post("/clear-token", (req, res) => {
      res.clearCookie("token").send({ success: true });
    });

    // Get the number of total food
    app.get("/total-food", async (req, res) => {
      const cursor = foodCollection.find();
      const result = (await cursor.toArray()).length;
      res.send({ total: result });
    });

    // Get all food
    app.get("/food", async (req, res) => {
      const searchInput = req.query.searchInput;
      const currentPage = req.query.currentPage;
      const numberOfItems = 9;
      let skipItem = currentPage * numberOfItems;

      let query = {};
      if (searchInput) {
        skipItem = 0;
        query = {
          $or: [{ foodName: { $regex: searchInput, $options: "i" } }],
        };
      }
      const cursor = foodCollection
        .find(query)
        .skip(skipItem)
        .limit(numberOfItems);
      const result = await cursor.toArray();
      res.send(result);
    });

    app.post("/food/category/:category", async (req, res) => {
      const category = req.params.category;
      const { currentFood } = req.body;

      const query = {
        foodCategory: category,
        _id: {
          $nin: [new ObjectId(currentFood)],
        },
      };

      const result = await foodCollection.find(query).toArray();

      res.send(result);
    });

    // Get top six food
    app.get("/top-food", async (req, res) => {
      const cursor = foodCollection.find().sort({ count: -1 }).limit(6);
      const result = await cursor.toArray();
      res.send(result);
    });

    // Get a specific food based on id
    app.get("/food/:id", async (req, res) => {
      const query = { _id: new ObjectId(req.params.id) };
      const result = await foodCollection.findOne(query);
      res.send(result);
    });

    // Add a food
    app.post("/add-food", verifyToken, async (req, res) => {
      const body = req.body;
      const result = await foodCollection.insertOne(body);
      res.send(result);
    });

    // Purchase a food
    app.post("/purchase", async (req, res) => {
      const { _id, ...productInfo } = req.body;
      const filter = { _id: new ObjectId(_id) };
      const update = {
        $inc: { count: 1, availableQuantity: -productInfo.quantity },
      };
      const currentFood = await foodCollection.findOne(filter);
      if (productInfo.email === currentFood.addedBy) {
        res.send({ success: false });
        return;
      }

      await foodCollection.updateOne(filter, update);
      await purchaseCollection.insertOne(productInfo);

      res.send({ success: true });
    });

    // Set registered user
    app.post("/set-user", async (req, res) => {
      const query = req.body;

      const filter = { email: query.email };
      const user = await userCollection.findOne(filter);
      if (user) {
        res.send({ success: true });
        return;
      }

      await userCollection.insertOne(query);
      res.send({ success: true });
    });

    // Get a users added food items
    app.post("/added-food-items", verifyToken, async (req, res) => {
      const email = req.body.email;
      const decodedEmail = req.decoded.email;
      if (email !== decodedEmail) {
        return res.status(404).send({ message: "Unauthorized" });
      }

      const query = { addedBy: email };
      const cursor = foodCollection.find(query);
      const result = await cursor.toArray();
      res.send(result);
    });

    // Get a users ordered food items
    app.post("/ordered-food-items", verifyToken, async (req, res) => {
      const email = req.body.email;
      const decodedEmail = req.decoded.email;

      if (email !== decodedEmail) {
        return res.status(404).send({ message: "Unauthorized" });
      }

      const query = { email: email };
      const cursor = purchaseCollection.find(query);
      const result = await cursor.toArray();
      res.send(result);
    });

    // Update food
    app.patch("/update-food", async (req, res) => {
      const { _id, ...query } = req.body;
      const filter = { _id: new ObjectId(_id) };
      const updateDoc = {
        $set: query,
      };
      const result = await foodCollection.updateOne(filter, updateDoc);
      res.send(result);
    });

    // Delete a food
    app.delete("/delete-food/:id", async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const result = await purchaseCollection.deleteOne(filter);
      res.send(result);
    });
  } catch (error) {
    console.error(error);
  }
}
run();

// Listening to the defined port
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
