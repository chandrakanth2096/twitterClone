const express = require("express");
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");
const path = require("path");

const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const app = express();
app.use(express.json());

let db = null;
const dbPath = path.join(__dirname, "twitterClone.db");

const initializeDBAndServer = async () => {
  try {
    db = await open({ filename: dbPath, driver: sqlite3.Database });
    app.listen(3000, () => {
      console.log("Server Running at http://localhost:3000/");
    });
  } catch (error) {
    console.log(`DB Error: ${error.message}`);
    process.exit(1);
  }
};
initializeDBAndServer();

const auth = (request, response, next) => {
  let jwtToken;
  const authHeader = request.headers["authorization"];
  if (authHeader !== undefined) {
    jwtToken = authHeader.split(" ")[1];
  }
  if (jwtToken !== undefined) {
    jwt.verify(jwtToken, "MySecretKey", async (error, payload) => {
      if (error) {
        response.status(401);
        response.send("Invalid JWT Token");
      } else {
        request.user_id = payload.user_id;
        request.username = payload.username;
        next();
      }
    });
  } else {
    response.status(401);
    response.send("Invalid JWT Token");
  }
};

app.get("/users/", async (request, response) => {
  const getUserQuery = `SELECT * FROM user;`;
  const usersArray = await db.all(getUserQuery);
  response.send(usersArray);
});

app.post("/register/", async (request, response) => {
  const { username, password, name, gender } = request.body;
  const getUserQuery = `SELECT * FROM user WHERE username = '${username}';`;
  const dbUser = await db.get(getUserQuery);

  if (dbUser === undefined) {
    const hashedPassword = await bcrypt.hash(password, 10);
    if (password.length >= 6) {
      const createUserQuery = `
        INSERT INTO
            user(username, password, name, gender)
        VALUES
            ('${username}', '${hashedPassword}', '${name}', '${gender}');`;
      await db.run(createUserQuery);
      response.send("User created successfully");
    } else {
      response.status(400);
      response.send("Password is too short");
    }
  } else {
    response.status(400);
    response.send("User already exists");
  }
});

app.post("/login/", async (request, response) => {
  const { username, password } = request.body;
  const getUserQuery = `SELECT * FROM user WHERE username = '${username}';`;
  const dbUser = await db.get(getUserQuery);

  if (dbUser !== undefined) {
    const isPasswordTrue = await bcrypt.compare(password, dbUser.password);

    if (isPasswordTrue) {
      const payload = { user_id: dbUser.user_id, username: username };
      const jwtToken = jwt.sign(payload, "MySecretKey");
      response.send({ jwtToken });
    } else {
      response.status(400);
      response.send("Invalid password");
    }
  } else {
    response.status(400);
    response.send("Invalid user");
  }
});

// {"jwtToken":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjoyLCJ1c2VybmFtZSI6IkpvZUJpZGVuIiwiaWF0IjoxNjU5MzY2ODk0fQ.kL14CB9bu7SevYv6NN7KfqTerhKYYVLYjK1V2wyWruU"}

const following = async (request, response, next) => {
  const { user_id } = request;
  const getFollowingUserQuery = `SELECT following_user_id FROM follower WHERE follower_user_id = ${user_id};`;
  const userFollowingArray = await db.all(getFollowingUserQuery);
  request.userFollowingArray = userFollowingArray;
  next();
};

app.get("/user/tweets/feed/", auth, following, async (request, response) => {
  const { userFollowingArray } = request;
  const userFollowing = userFollowingArray.map((each) => {
    return each.following_user_id;
  });
  const tweetsOfUserFollowing = `
    SELECT
        username,
        tweet,
        date_time AS dateTime
    FROM
        user JOIN tweet ON tweet.user_id = user.user_id
    WHERE
        user.user_id IN (${userFollowing})
    ORDER BY
        date_time DESC
    LIMIT 4;`;
  const tweetsArray = await db.all(tweetsOfUserFollowing);
  response.send(tweetsArray);
});

app.get("/user/following/", auth, following, async (request, response) => {
  const { userFollowingArray } = request;
  const userFollowing = userFollowingArray.map((each) => {
    return each.following_user_id;
  });

  const userFollowingNames = `SELECT name FROM user WHERE user_id IN (${userFollowing});`;
  const followingNames = await db.all(userFollowingNames);
  response.send(followingNames);
});

app.get("/user/followers/", auth, async (request, response) => {
  const { user_id } = request;
  const getFollowersUserQuery = `SELECT follower_user_id FROM follower WHERE following_user_id = ${user_id};`;
  const userFollowers = await db.all(getFollowersUserQuery);

  const userFollowersArray = userFollowers.map((each) => {
    return each.follower_user_id;
  });
  const userFollowerNames = `SELECT name FROM user WHERE user_id IN (${userFollowersArray});`;
  const followerNames = await db.all(userFollowerNames);
  response.send(followerNames);
});

const getTweetId = async (request, response, next) => {
  const { userFollowingArray } = request;
  const userFollowing = userFollowingArray.map((each) => {
    return each.following_user_id;
  });

  const userFollowingTweets = `SELECT tweet_id FROM tweet WHERE user_id IN (${userFollowing});`;
  const followingTweets = await db.all(userFollowingTweets);
  request.followingTweets = followingTweets;
  next();
};

app.get("/tweets/:tweetId/", auth, following, getTweetId, async (req, res) => {
  const { tweetId } = req.params;
  const { followingTweets } = req;

  const userFollowingTweets = followingTweets.map((each) => {
    return each.tweet_id;
  });

  if (userFollowingTweets.includes(parseInt(tweetId))) {
    const getTweetQuery = `SELECT tweet, date_time FROM tweet WHERE tweet_id IN (${tweetId});`;
    const getTweet = await db.get(getTweetQuery);

    const getTotalLikes = `SELECT COUNT(like_id) AS likes FROM like WHERE tweet_id IN(${tweetId});`;
    const totalLikes = await db.get(getTotalLikes);

    const getTotalReplies = `SELECT COUNT(reply_id) AS replies FROM reply WHERE tweet_id IN(${tweetId});`;
    const totalReplies = await db.get(getTotalReplies);

    res.send({
      tweet: getTweet.tweet,
      likes: totalLikes.likes,
      replies: totalReplies.replies,
      dateTime: getTweet.date_time,
    });
  } else {
    res.status(401);
    res.send("Invalid Request");
  }
});

const getUserLikeNames = (names) => {
  namesArray = [];
  for (let i of names) {
    namesArray.push(i.username);
  }
  return { likes: namesArray };
};

const getReplyDetails = (replies) => {
  const repliesArray = [];
  replies.map((each) => {
    repliesArray.push(each);
  });
  return { replies: repliesArray };
};

app.get(
  "/tweets/:tweetId/likes/",
  auth,
  following,
  getTweetId,
  async (req, res) => {
    const { tweetId } = req.params;
    const { followingTweets } = req;

    const userFollowingTweets = followingTweets.map((each) => {
      return each.tweet_id;
    });

    if (userFollowingTweets.includes(parseInt(tweetId))) {
      const whoLikedTweet = `
        SELECT
            username
        FROM
            user JOIN like ON like.user_id = user.user_id
        WHERE
            like.tweet_id IN (${tweetId});`;
      const names = await db.all(whoLikedTweet);
      res.send(getUserLikeNames(names));
    } else {
      res.status(401);
      res.send("Invalid Request");
    }
  }
);

app.get(
  "/tweets/:tweetId/replies/",
  auth,
  following,
  getTweetId,
  async (req, res) => {
    const { tweetId } = req.params;
    const { followingTweets } = req;

    const userFollowingTweets = followingTweets.map((each) => {
      return each.tweet_id;
    });

    if (userFollowingTweets.includes(parseInt(tweetId))) {
      const followingReplies = `
        SELECT
            name, reply
        FROM
            user JOIN reply ON reply.user_id = user.user_id
        WHERE
            reply.tweet_id = ${tweetId};`;
      const replies = await db.all(followingReplies);
      res.send(getReplyDetails(replies));
    } else {
      res.status(401);
      res.send("Invalid Request");
    }
  }
);

app.get("/user/tweets/", auth, async (req, res) => {
  const { user_id } = req;
  const getTweetsOfUser = `SELECT tweet_id FROM tweet WHERE user_id = ${user_id};`;
  const userTweetsArray = await db.all(getTweetsOfUser);

  const tweetsArray = userTweetsArray.map((each) => {
    return each.tweet_id;
  });
  console.log(tweetsArray);

  const getUserTweets = `
    SELECT
        tweet.tweet, COUNT(DISTINCT like.like_id) AS likes,
        COUNT(DISTINCT reply.reply_id) AS replies, tweet.date_time AS dateTime
    FROM
        tweet LEFT JOIN like ON tweet.tweet_id = like.tweet_id
        LEFT JOIN reply ON tweet.tweet_id = reply.tweet_id
    WHERE
        tweet.tweet_id IN (${tweetsArray})
    GROUP BY
        tweet.tweet_id;`;
  const result = await db.all(getUserTweets);
  res.send(result);
});

app.post("/user/tweets/", auth, async (req, res) => {
  const { user_id } = req;
  const { tweet } = req.body;
  const date = new Date();
  const dateTime = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()} ${date.getHours()}:${date.getMinutes()}:${date.getSeconds()}`;

  const createTweetbyUser = `
    INSERT INTO
        tweet(tweet, user_id, date_time)
    VALUES
        ('${tweet}', ${user_id}, '${dateTime}');`;
  await db.run(createTweetbyUser);
  res.send("Created a Tweet");
});

app.delete("/tweets/:tweetId/", auth, async (req, res) => {
  const { user_id } = req;
  const { tweetId } = req.params;
  const getUserTweets = `SELECT * FROM tweet WHERE user_id = ${user_id};`;
  const userTweets = await db.all(getUserTweets);
  const userOwnTweets = userTweets.map((each) => {
    return each.tweet_id;
  });

  if (userOwnTweets.includes(parseInt(tweetId))) {
    const deleteUserTweet = `
          DELETE FROM tweet WHERE tweet_id = ${tweetId};`;
    await db.run(deleteUserTweet);
    res.send("Tweet Removed");
  } else {
    res.status(401);
    res.send("Invalid Request");
  }
});

module.exports = app;
