require("dotenv").config();
const express = require("express");
const cors = require("cors");
const session = require("express-session");
const passport = require("passport");
const fs = require("fs");
const { generateToken } = require("./utils/jwt");
const SamlStrategy = require("passport-saml").Strategy;
const authenticateJWT=require("./Middleware/auth")
const {
  DynamoDBClient,
  ListTablesCommand,
} = require("@aws-sdk/client-dynamodb");
const { ScanCommand } = require("@aws-sdk/client-dynamodb");
const { unmarshall } = require("@aws-sdk/util-dynamodb");
const {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
} = require("@aws-sdk/client-s3");
const { QueryCommand } = require("@aws-sdk/lib-dynamodb");
const bodyParser = require("body-parser");
const serverless = require('serverless-http');
// Express app
const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(
  cors({
    origin: `${process.env.FRONTEND_URL}`, // 
    credentials: true, // 
  })
);
// app.use(cors())
app.use(express.json());

// DynamoDB Client
const ddbClient = new DynamoDBClient({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

// Test connection
async function testConnection() {
  try {
    const command = new ListTablesCommand({});
    const data = await ddbClient.send(command);
    console.log("DynamoDB connection successful!");
  } catch (err) {
    console.error("DynamoDB connection failed:", err);
  }
}

// Call it once at startup
testConnection();
module.exports.ddbClient = ddbClient;




// 1️⃣ Session middleware
app.use(
  session({
    secret: "supersecret",
    resave: false,
    saveUninitialized: true,
  })
);

// 2️⃣ Body parser for ACS POST binding
app.use(bodyParser.urlencoded({ extended: false }));

// 3️⃣ Initialize Passport
app.use(passport.initialize());
app.use(passport.session());

// 4️⃣ Load SP key and cert
const spPrivateKey = fs.readFileSync("./sp-private-key.pem", "utf8");
const spCertificate = fs.readFileSync("./sp-certificate.pem", "utf8");

// 5️⃣ IdP public certificate
const idpCertificate = fs.readFileSync("./idp-certificate.pem", "utf8");

// 6️⃣ Configure SAML strategy
passport.use(
  new SamlStrategy(
    {
      entryPoint: "https://idp.bits-pilani.ac.in/idp/profile/SAML2/Redirect/SSO",
      issuer: "https://wilpbits-sri.us-east-1.elasticbeanstalk.com/metadata",
      callbackUrl: "https://wilpbits-sri.us-east-1.elasticbeanstalk.com/sso/callback",
      cert: idpCertificate, // IdP cert for verifying incoming SAMLResponse
      privateCert: spPrivateKey, // SP private key for signing AuthnRequest
      decryptionPvk: spPrivateKey, // Optional: if IdP encrypts assertions
      signatureAlgorithm: "sha256",
      digestAlgorithm: "sha256",
      wantAuthnRequestSigned: true,
      acceptedClockSkewMs: 5000,
      wantAssertionsSigned: true,
      identifierFormat:'urn:oasis:names:tc:SAML:2.0:nameid-format:transient',
    },
    (profile, done) => {
      console.log("SAML profile received:", profile);
   const email =
    profile['urn:oid:0.9.2342.19200300.100.1.3'] || profile.email || null;
  const uid =
    profile['urn:oid:0.9.2342.19200300.100.1.1'] || null;
  const employeeType =
    profile['urn:oid:2.16.840.1.113730.3.1.4'] || null;

  const user = {
    email,
    uid,
    employeeType,
    nameID: profile.nameID,
  };

  return done(null, user);
    }
  )
);

// Serialize user session
passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((user, done) => done(null, user));

// 8️⃣ Initiate SSO login
app.get(
  "/sso/login",
  passport.authenticate("saml", { failureRedirect: "/", failureFlash: true })
);

app.post(
  "/sso/callback",
  passport.authenticate("saml", {
    failureRedirect: `${process.env.FRONTEND_URL}/login?error=unauthorized`,
    failureFlash: true,
  }),
  (req, res) => {
    const token = generateToken(req.user);
    req.session.jwt = token;

    res.redirect(`${process.env.FRONTEND_URL}/home`);
  }
);

// Route to return user data
app.get("/api/me", authenticateJWT, (req, res) => {
  if (req.isAuthenticated && req.isAuthenticated()) {
    console.log("✅ req.user:", req.user); // 🔍 log the full object
    return res.json(req.user);
  }
  return res.status(401).json({ error: "Unauthorized" });
});




app.get("/sso/logout", (req, res) => {
  req.logout(() => {
    req.session.destroy(() => {
      res.clearCookie("connect.sid");
       // if using default session cookie
      res.redirect(`${process.env.FRONTEND_URL}/`);
    });
  });
});

// 1Check session
app.get("/user", (req, res) => {
  if (req.isAuthenticated()) {
    res.json({ user: req.user });
  } else {
    res.status(401).json({ error: "Not authenticated" });
  }
});


const ID = "_sp_" + Math.random().toString(36).substring(2, 12);

app.get("/metadata", (req, res) => {


  const metadata = `
<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata"
                     xmlns:ds="http://www.w3.org/2000/09/xmldsig#"
                    entityID="https://wilpbits-sri.us-east-1.elasticbeanstalk.com/metadata"
                     ID="${ID}">

  <md:SPSSODescriptor protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol"
                       AuthnRequestsSigned="false"
                       WantAssertionsSigned="true">

    <md:NameIDFormat>urn:oasis:names:tc:SAML:2.0:nameid-format:transient</md:NameIDFormat>

    <md:KeyDescriptor use="signing">
       <ds:KeyInfo xmlns:ds="http://www.w3.org/2000/09/xmldsig#">
        <ds:KeyName>labserver2.bits-pilani.ac.in</ds:KeyName>
        <ds:X509Data>
         <ds:X509Certificate>MIIEGzCCAoOgAwIBAgIJAKvE+k5gLmGNMA0GCSqGSIb3DQEBCwUAMCcxJTAjBgNV
BAMTHGxhYnNlcnZlcjIuYml0cy1waWxhbmkuYWMuaW4wHhcNMTgwNTE2MTQ0NTUx
WhcNMjgwNTEzMTQ0NTUxWjAnMSUwIwYDVQQDExxsYWJzZXJ2ZXIyLmJpdHMtcGls
YW5pLmFjLmluMIIBojANBgkqhkiG9w0BAQEFAAOCAY8AMIIBigKCAYEAz47J1lqi
1vivMfSHp67CHDjSWICdN/kga9yxUpJW+LOaQAVMXdlLIv3Ua45b8z9a2SGlTnu5
h+SzN2lfKskQ1mRhjcgOPd4lzupRau44J1eP6EvqQeRHCmhDk726KG9gCI1L8NmG
0rLy62f9RQFSoA8DvKaTFXwoxojNofDKkLIKRMIQDDUcQQ/gDalcSw2TM59xcz4x
bRsLSwocC0AOfBr58V3qq/Sx05SuOlYjn5QfmFj3tS3Y51Hdam4NgIuOsdJCOLkT
iLgtUqtnNWpqC/JmfPHnxEIEPZjzvZOxoFbN46E+v0O5Zl10Jx2P4msVmNql2AJS
Q6ZnndiSxF7AtY729dHoGC2q9zAf/d1ILxI/KDRo+EnMlQB3Pc+JW6XcAleLrvXw
goGt2bhhNdMmADeRdHvkmHNCPchbxWsmvGXRDMVU3d11KwvVbLQspnH7h3njVfyy
wxuM7UZba3gpWgq0Vo1v/KGCQBhNECGBzj5MstL9jXk5SU1875sxWz3zAgMBAAGj
SjBIMCcGA1UdEQQgMB6CHGxhYnNlcnZlcjIuYml0cy1waWxhbmkuYWMuaW4wHQYD
VR0OBBYEFDtQ6SvizJTgvHws+3nGJyN5DtaxMA0GCSqGSIb3DQEBCwUAA4IBgQB7
aijXw/DMPK8iCcb8Bqfaa4HnZH//iIAAw67EIQoxGaMWSggfHsn1rjrgeyaiPje7
/7aLJ2y+aD2GCbD3plN9ogEJR2rEkDeMDOTNri2cEOjJ7koN7OvNuRSwMtvSGWop
5mSg1hTn146jSFNlaLBvJBTmEvthD8CD2iDQw89MGEoHSbp4BwmdeWuK181hj6D3
M0bcUssMe/r9qzEISrO+y5i52Zt+3p+5pO8wDmfvAIMuFVLgcgFfY1Tj3ofO5t6g
SoAC9k3PQI1mjhxRj4qaGlusGiefMuf/GfGKN9hOKF/CADUUqeDLec3sspt4HG1j
yWVESN9tuptA+RkhJpuoeZbz3Av94u0pWrrazX/tuiGPVOLZqmB7nSk4skJsoHqc
mKCmDwu61oSdwMhE5tndAkEC5aOM2dAl89jalY8yKJS38jlkZ3NOqXXDvRZ/zKtR
X/RdLh3KB1VqqDDiLSKoyAo4gbJygdm2VkwexT8DP6LMZh0DBGIqW6VsAsr6cuY=
</ds:X509Certificate>
        </ds:X509Data>
         </ds:KeyInfo>
    </md:KeyDescriptor>

    <md:AssertionConsumerService index="1" isDefault="true"
      Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST"
      Location="https://wilpbits-sri.us-east-1.elasticbeanstalk.com/sso/callback"/>

  </md:SPSSODescriptor>
</md:EntityDescriptor>
  `.trim();

  res.type("application/xml");
  res.send(metadata);
});


// Simple index page
app.get("/", (req, res) => {
  res.send(`
    <h1>SAML SSO Example</h1>
    <a href="/sso/login">Login with SAML</a><br/>
    <a href="/metadata" target="_blank">View SP Metadata</a><br/>
    <button onclick="fetch('/user').then(r => r.json()).then(j => alert(JSON.stringify(j, null, 2)))">
      Check Session
    </button>
  `);
});

app.get("ExaminerDetails", async (req, res) => {
  try {
    const data = await ddbClient.send(
      new ScanCommand({ TableName: "PlanID_Course_Details" })
    );
    const items = data.Items.map((item) => unmarshall(item));
    res.json(items);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not fetch Question_Paper_Details" });
  }
});
app.get("/CourseExaminer_Mapping", async (req, res) => {
  try {
    const data = await ddbClient.send(
      new ScanCommand({ TableName: "CourseExaminer_Mapping" })
    );
    const items = data.Items.map((item) => unmarshall(item));
    res.json(items);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not fetch Question_Paper_Details" });
  }
});















const s3Client = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

module.exports.s3Client = s3Client;

// Stream-to-string helper
async function streamToString(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on("data", (chunk) => chunks.push(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
  });
}




// API Routes
const studentRoutes = require("./Routes/StudentRoutes");

app.use("/api/students", studentRoutes);





// module.exports.handler = serverless(app);


(async () => {
  app.listen(PORT, () => {
    console.log(`Server is running on port : ${PORT}`);
  });
})();



// server.js
// require("dotenv").config();
// const express = require("express");
// const cors = require("cors");
// const session = require("express-session");
// const passport = require("passport");
// const SamlStrategy = require("passport-saml").Strategy;
// const serverless = require("serverless-http");
// const bodyParser = require("body-parser");
// const fs = require("fs");
// const {
//   DynamoDBClient,
//   ScanCommand,
//   ListTablesCommand,
// } = require("@aws-sdk/client-dynamodb");
// const { unmarshall } = require("@aws-sdk/util-dynamodb");
// const {
//   S3Client,
// } = require("@aws-sdk/client-s3");

// const app = express();

// // Middleware
// app.use(cors({ credentials: true, origin: "*" }));
// app.use(express.json());
// app.use(bodyParser.urlencoded({ extended: false }));
// app.use(
//   session({
//     secret: "saml-secret",
//     resave: false,
//     saveUninitialized: true,
//   })
// );
// app.use(passport.initialize());
// app.use(passport.session());

// // DynamoDB Client
// const ddbClient = new DynamoDBClient({
//   region: process.env.AWS_REGION,
//   credentials: {
//     accessKeyId: process.env.AWS_ACCESS_KEY_ID,
//     secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
//   },
// });

// // Test DynamoDB connection
// (async () => {
//   try {
//     const command = new ListTablesCommand({});
//     const data = await ddbClient.send(command);
//     console.log("DynamoDB connection successful!");
//   } catch (err) {
//     console.error("DynamoDB connection failed:", err);
//   }
// })();
// module.exports.ddbClient = ddbClient;

// // S3 Client
// const s3Client = new S3Client({
//   region: process.env.AWS_REGION,
//   credentials: {
//     accessKeyId: process.env.AWS_ACCESS_KEY_ID,
//     secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
//   },
// });
// module.exports.s3Client = s3Client;

// // Stream helper (if you need it)
// module.exports.streamToString = async function (stream) {
//   return new Promise((resolve, reject) => {
//     const chunks = [];
//     stream.on("data", (chunk) => chunks.push(chunk));
//     stream.on("error", reject);
//     stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
//   });
// };

// // SAML Strategy
// const samlStrategy = new SamlStrategy(
//   {
//     entryPoint: "https://idp.bits-pilani.ac.in/idp/profile/SAML2/Redirect/SSO",
//     issuer: "https://elearn3.bits-pilani.ac.in/shibboleth",
//     callbackUrl: "https://elearn.bits-pilani.ac.in/Shibboleth.sso/Login",
//     cert: `-----BEGIN CERTIFICATE-----
// YOUR_CERT_CONTENT_HERE
// -----END CERTIFICATE-----`,
//     identifierFormat: null,
//   },
//   function (profile, done) {
//     console.log("SAML Profile:", profile);
//     return done(null, profile);
//   }
// );

// passport.use(samlStrategy);
// passport.serializeUser((user, done) => done(null, user));
// passport.deserializeUser((user, done) => done(null, user));

// // SAML routes
// app.get("/sso/login", passport.authenticate("saml"));
// app.post(
//   "/sso/callback",
//   passport.authenticate("saml", { failureRedirect: "/" }),
//   (req, res) => {
//     res.redirect("/");
//   }
// );
// app.get("/metadata", (req, res) => {
//   res.type("application/xml");
//   res.send(samlStrategy.generateServiceProviderMetadata());
// });
// app.get("/user", (req, res) => {
//   if (req.isAuthenticated()) {
//     res.json({
//       userID: req.user.bitsId,
//       attributes: req.user,
//     });
//   } else {
//     res.status(401).json({ error: "Not logged in" });
//   }
// });

// // Example DynamoDB route
// app.get("/api/students/bits", async (req, res) => {
//   try {
//     const data = await ddbClient.send(
//       new ScanCommand({ TableName: "Revaluation-registration-details" })
//     );
//     const items = data.Items.map((item) => unmarshall(item));
//     res.json(items);
//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ error: "Could not fetch records" });
//   }
// });

// // Modular routes example
// const studentRoutes = require("./Routes/StudentRoutes");
// app.use("/api/students", studentRoutes);

// // Export handler for Lambda
// module.exports.handler = serverless(app);
