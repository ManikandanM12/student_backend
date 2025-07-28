// Routes/StudentRoutes.js
const express = require("express");
const router = express.Router();
const { ddbClient } = require("../app");
const { QueryCommand,ScanCommand } = require("@aws-sdk/lib-dynamodb");
const { unmarshall } = require("@aws-sdk/util-dynamodb");
const { GetObjectCommand } = require("@aws-sdk/client-s3");
const { streamToString } = require("../utils/utils");
const { s3Client } = require("../app");
const { ListObjectsV2Command } = require("@aws-sdk/client-s3");
const { PutItemCommand } = require("@aws-sdk/client-dynamodb");
const csv = require("csv-parser");
const authenticateJWT=require("../Middleware/auth.js")

router.post("/login", async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: "Username and password are required" });
  }

  try {
    const command = new GetObjectCommand({
      Bucket: "wilp-fr-model",
      Key: "TestingData/2024wd_testing.csv",
    });

    const data = await s3Client.send(command);

    const results = [];

    await new Promise((resolve, reject) => {
      data.Body.pipe(csv())
        .on("data", (row) => results.push(row))
        .on("end", resolve)
        .on("error", reject);
    });

    const user = results.find(
      (u) =>
        u.EmailAddress.toLowerCase() === username.toLowerCase() &&
        u.Password === password
    );

    if (!user) {
      return res.status(401).json({ error: "Invalid username or password" });
    }

    return res.json({ BITSID: user.BITSID });
  } catch (error) {
    console.error("❌ Login error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});


router.post("/get-applied-questions", async (req, res) => {
  let { registerNumber, courseCode, examDate } = req.body;

  if (!registerNumber || !courseCode || !examDate) {
    return res.status(400).json({ error: "Missing fields" });
  }

  try {
    //  Normalize
    const safeRegisterNumber = registerNumber.trim().toLowerCase();

    let safeCourseCode = courseCode.trim();
    if (!safeCourseCode.includes(" ")) {
      safeCourseCode = safeCourseCode.slice(0, 4) + " " + safeCourseCode.slice(4);
    }

    const safeExamDate = examDate.includes("-")
      ? examDate.replace(/-/g, "/")
      : examDate;
const formatCourseCode = (code) => {
  const cleaned = code.replace(/\s+/g, "").toUpperCase();
  const zIndex = cleaned.indexOf("Z");
  return zIndex > 0 ? cleaned.slice(0, zIndex) + " " + cleaned.slice(zIndex) : cleaned;
};

    const serialPrefix = `${formatCourseCode(courseCode)}_${safeExamDate}`;

    console.log("Serial prefix:", serialPrefix);
    console.log("Safe RegisterNumber:", safeRegisterNumber);

    const params = {
      TableName: "Student_Reevaluation_Details",
      IndexName: "RegisterNumber-SerialNumber-index", // Your GSI name
      KeyConditionExpression: "#reg = :reg AND begins_with(#sn, :serialPrefix)",
      FilterExpression: "#st = :appliedStatus", // Only if you need to filter by status
      ExpressionAttributeNames: {
        "#reg": "RegisterNumber",
        "#sn": "SerialNumber",
        "#st": "Status",
      },
      ExpressionAttributeValues: {
        ":reg": safeRegisterNumber,
        ":serialPrefix": serialPrefix,
        ":appliedStatus": "Applied",
      },
    };

    const command = new QueryCommand(params);
    const result = await ddbClient.send(command);

    // console.log("Found items:", result.Items);

    const appliedQuestions = result.Items?.map((item) => ({
      QuestionNo: item.QuestionNo,
      status: item.Status?.toLowerCase() || "unknown",
    })) || [];

    res.json(appliedQuestions);
  } catch (error) {
    console.error(" Error:", error);
    res.status(500).json({ error: "Server error while fetching applied questions" });
  }
});




// router.post("/courses",authenticateJWT,async (req, res) => {
//   const bitsId = req.body.bitsId?.trim();
//   if (!bitsId) {
//     return res.status(400).json({ error: "BITS ID is required" });
//   }

//   const normalize = (str) => str?.replace(/\s+/g, "").trim().toUpperCase();
//   const formatCourseCode = (code) => {
//     const cleaned = code.replace(/\s+/g, "");
//     return cleaned.length > 4 ? cleaned.slice(0, 4) + " " + cleaned.slice(4) : cleaned;
//   };
//   const extractExamDate = (slot) => {
//     const dateMatch = slot?.match(/\d{2}\/\d{2}\/\d{4}/);
//     if (!dateMatch) return null;
//     const fullDate = dateMatch[0];
//     return {
//       formatted: fullDate.replace(/\//g, "-"), // 18-05-2025
//       slash: fullDate, // 18/05/2025
//       short: fullDate.replace(/\/20(\d{2})$/, "/$1"), // 18/05/25
//     };
//   };

//   try {
//     // 1) Always get student
//     const studentQuery = new QueryCommand({
//       TableName: process.env.TABLE2_NAME,
//       KeyConditionExpression: "#bitsId = :bitsId",
//       ExpressionAttributeNames: { "#bitsId": "BITS ID" },
//       ExpressionAttributeValues: { ":bitsId": bitsId },
//     });

//     const studentDataRaw = await ddbClient.send(studentQuery);

//     if (!studentDataRaw.Items || studentDataRaw.Items.length === 0) {
//       return res.status(404).json({ error: "Student not found" });
//     }

//     const student = studentDataRaw.Items[0];

//     const finalStudentData = {
//       bitsId: student["BITS ID"],
//       name: student["Name"],
//       programme: student["PROGRAMME"],
//       plan: student["Plan"],
//       examCity: student["Exam City"],
//       examCentre: student["Centre Name"],
//       phone: student["Phone No."],
//       bitsMail: student["BITS Mail Id"],
//       courses: {},
//       revaluationEligible: [],
//     };

//     // 2) Try to find eligible courses
//     const courseKeys = Object.keys(student).filter((k) => /^Course \d+$/.test(k));
//     const uniqueCourseCodes = Array.from(
//       new Set(courseKeys.map((k) => normalize(student[k])))
//     );

//     const courseMaster = [];
//     for (const courseCode of uniqueCourseCodes) {
//       const courseQuery = new QueryCommand({
//         TableName: process.env.TABLE1_NAME,
//         KeyConditionExpression: "#code = :code",
//         ExpressionAttributeNames: { "#code": "Course Code" },
//         ExpressionAttributeValues: { ":code": courseCode },
//       });
//       const result = await ddbClient.send(courseQuery);
//       if (result.Items?.length > 0) {
//         courseMaster.push(...result.Items);
//       }
//     }

//     let courseIndex = 1;

//     for (const courseKey of courseKeys) {
//       const courseCode = student[courseKey];
//       if (!courseCode) continue;

//       const indexNum = courseKey.split(" ")[1];
//       const slotKey = `Exam Slot.${indexNum}`;
//       const slot = student[slotKey];
//       if (!slot) continue;

//       const examDate = extractExamDate(slot);
//       if (!examDate) continue;

//       const revalQuery = new QueryCommand({
//         TableName: "PlanID_Course_Details",
//         IndexName: "Course-ExamDate-index",
//         KeyConditionExpression: "#course = :course AND #examDate = :examDate",
//         ExpressionAttributeNames: { "#course": "Course", "#examDate": "ExamDate" },
//         ExpressionAttributeValues: {
//           ":course": normalize(courseCode),
//           ":examDate": examDate.short,
//         },
//       });

//       const ruleData = await ddbClient.send(revalQuery);
//       const matchedRule = ruleData.Items?.find(
//         (rule) => normalize(rule.Course) === normalize(courseCode) && rule.RevaluationFlag === "Yes"
//       );

//       if (!matchedRule) continue;

//       const courseDetails = courseMaster.find(
//         (c) => normalize(c["Course Code"]) === normalize(courseCode)
//       );

//       const courseData = {
//         code: courseCode,
//         examSlot: slot,
//         subject: courseDetails?.["Course Name"] || "-",
//         questionsCount: 0,
//         marksData: [],
//         revaluationMarksSample: [],
//       };

//       const formattedCode = formatCourseCode(courseCode);
//       const folderName = `${formattedCode}_${examDate.formatted}`;
//       const s3Key = `Question_bank/${folderName}/marks.csv`;

//       try {
//         const s3Params = { Bucket: "wilp-fr-model", Key: s3Key };
//         const s3Data = await s3Client.send(new GetObjectCommand(s3Params));
//         const csvString = await streamToString(s3Data.Body);
//         const rows = csvString.trim().split("\n").map((line) => line.split(","));
//         const computedCount = rows.length > 1 ? rows.length - 1 : 0;

//         if (computedCount > 0) {
//           courseData.questionsCount = computedCount;
//           courseData.marksData = rows.slice(1);
//         }
//       } catch (err) {
//         console.warn(`marks.csv error for ${s3Key}:`, err.message);
//       }

//       const serialPrefix = `${formattedCode}_${examDate.slash}_`;

//       const sampleQuery = new QueryCommand({
//         TableName: "wilp_marks",
//         IndexName: "RegisterNumber-SerialNumber-index",
//         KeyConditionExpression:
//           "#rn = :regNo AND begins_with(#sn, :coursePrefix)",
//         FilterExpression: "#ed = :examDate",
//         ExpressionAttributeNames: {
//           "#rn": "RegisterNumber",
//           "#sn": "SerialNumber",
//           "#ed": "ExamDate",
//         },
//         ExpressionAttributeValues: {
//           ":regNo": bitsId.toLowerCase(),
//           ":coursePrefix": serialPrefix,
//           ":examDate": examDate.formatted,
//         },
//       });

//       try {
//         const sampleData = await ddbClient.send(sampleQuery);
//         const items = sampleData.Items || [];
//         const totalMarks = items.reduce((sum, item) => {
//           const val = parseFloat(item.Marks);
//           return sum + (isNaN(val) ? 0 : val);
//         }, 0);

//         courseData.revaluationMarksSample = {
//           count: items.length,
//           totalMarks,
//           items,
//         };
//       } catch (err) {
//         console.error(`Revaluation_Marks_Sample error for ${courseCode}:`, err.message);
//       }

//       finalStudentData.courses[`course${courseIndex}`] = courseData;
//       finalStudentData.revaluationEligible.push({
//         courseCode: formattedCode,
//         examDate: examDate.formatted,
//         subject: courseData.subject,
//         fromDate: matchedRule.FromDate,
//         endDate: matchedRule.EndDate,
//       });

//       courseIndex++;
//     }

//     res.json(finalStudentData); 
//   } catch (err) {
//     console.error("Server error:", err);
//     res.status(500).json({ error: "Internal server error" });
//   }
// });




//   const bitsId = req.body.bitsId?.trim();
//   if (!bitsId) {
//     return res.status(400).json({ error: "BITS ID is required" });
//   }

//   // ✅ Helpers
//   const normalize = (str) => str?.replace(/\s+/g, "").trim().toUpperCase();

//   const formatCourseCode = (code) => {
//     const cleaned = code.replace(/\s+/g, "");
//     return cleaned.length > 4
//       ? cleaned.slice(0, 4) + " " + cleaned.slice(4)
//       : cleaned;
//   };

//   const extractExamDate = (slot) => {
//     const dateMatch = slot?.match(/\d{2}\/\d{2}\/\d{4}/);
//     if (!dateMatch) return null;
//     const fullDate = dateMatch[0];
//     return {
//       formatted: fullDate.replace(/\//g, "-"), // 18-05-2025
//       slash: fullDate, // 18/05/2025
//       short: fullDate.replace(/\/20(\d{2})$/, "/$1"), // 18/05/25
//     };
//   };

//   try {
//     // 1️⃣ Get student record
//     const studentQuery = new QueryCommand({
//       TableName: process.env.TABLE2_NAME,
//       KeyConditionExpression: "#bitsId = :bitsId",
//       ExpressionAttributeNames: { "#bitsId": "BITS ID" },
//       ExpressionAttributeValues: { ":bitsId": bitsId },
//     });

//     const studentDataRaw = await ddbClient.send(studentQuery);

//     if (!studentDataRaw.Items || studentDataRaw.Items.length === 0) {
//       return res.status(404).json({ error: "Student not found" });
//     }

//     const student = studentDataRaw.Items[0];

//     // 2️⃣ Collect ALL Course keys dynamically
//     const courseKeys = Object.keys(student).filter((k) =>
//       /^Course \d+$/.test(k)
//     );
//     courseKeys.sort((a, b) => {
//       const aNum = parseInt(a.split(" ")[1], 10);
//       const bNum = parseInt(b.split(" ")[1], 10);
//       return aNum - bNum;
//     });

//     // 3️⃣ Fetch course master details once
//     const uniqueCourseCodes = Array.from(
//       new Set(courseKeys.map((k) => normalize(student[k])))
//     );
//     const courseMaster = [];
//     for (const courseCode of uniqueCourseCodes) {
//       const courseQuery = new QueryCommand({
//         TableName: process.env.TABLE1_NAME,
//         KeyConditionExpression: "#code = :code",
//         ExpressionAttributeNames: { "#code": "Course Code" },
//         ExpressionAttributeValues: { ":code": courseCode },
//       });
//       const result = await ddbClient.send(courseQuery);
//       if (result.Items?.length > 0) {
//         courseMaster.push(...result.Items);
//       }
//     }

//     // 4️⃣ Build final student data
//     const finalStudentData = {
//       bitsId: student["BITS ID"],
//       name: student["Name"],
//       programme: student["PROGRAMME"],
//       plan: student["Plan"],
//       examCity: student["Exam City"],
//       examCentre: student["Centre Name"],
//       phone: student["Phone No."],
//       bitsMail: student["BITS Mail Id"],
//       courses: {},
//       revaluationEligible: [],
//     };

//     let courseIndex = 1;

//     // 5️⃣ Process each Course N dynamically
//     for (const courseKey of courseKeys) {
//       const courseCode = student[courseKey];
//       if (!courseCode) continue;

//       const indexNum = courseKey.split(" ")[1];
//       const slotKey = `Exam Slot.${indexNum}`;
//       const slot = student[slotKey];
//       if (!slot) continue;

//       const examDate = extractExamDate(slot);
//       if (!examDate) continue;

//       // 🔍 Check if eligible for revaluation
//       const revalQuery = new QueryCommand({
//         TableName: "AdminReEvaluation",
//         IndexName: "CourseExamDateIndex",
//         KeyConditionExpression: "#course = :course AND #examDate = :examDate",
//         ExpressionAttributeNames: {
//           "#course": "Course",
//           "#examDate": "ExamDate",
//         },
//         ExpressionAttributeValues: {
//           ":course": normalize(courseCode),
//           ":examDate": examDate.short,
//         },
//       });

//       const ruleData = await ddbClient.send(revalQuery);
//       const matchedRule = ruleData.Items?.find(
//         (rule) =>
//           normalize(rule.Course) === normalize(courseCode) &&
//           rule.RevaluationFlag === "Yes"
//       );
//       if (!matchedRule) continue;

//       // 🔍 Get course master details
//       const courseDetails = courseMaster.find(
//         (c) => normalize(c["Course Code"]) === normalize(courseCode)
//       );

//       const courseData = {
//         code: courseCode,
//         examSlot: slot,
//         subject: courseDetails?.["Course Name"] || "-",
//         questionsCount: 0,
//         marksData: [],
//         revaluationMarksSample: [],
//       };

//       // 🗂️ Pull marks.csv
//       const formattedCode = formatCourseCode(courseCode);
//       const folderName = `${formattedCode}_${examDate.formatted}`;
//       const s3Key = `Question_bank/${folderName}/marks.csv`;

//      try {
//   const s3Params = { Bucket: "wilp-fr-model", Key: s3Key };
//   const s3Data = await s3Client.send(new GetObjectCommand(s3Params));
//   const csvString = await streamToString(s3Data.Body);
//   const rows = csvString.trim().split("\n").map((line) => line.split(","));
//   const computedCount = rows.length > 1 ? rows.length - 1 : 0;

//   if (computedCount > 0) {
//     courseData.questionsCount = computedCount;
//     courseData.marksData = rows.slice(1);
//   } else {
//     console.warn(`marks.csv empty or invalid for ${s3Key}`);
//     // Keep fallback count
//   }
// } catch (err) {
//   console.error(`S3 Error for ${s3Key}:`, err.message);
//   // Keep fallback count
// }

//       // 📝 Check Revaluation_Marks_Sample
//       const serialPrefix = `${formattedCode}_${examDate.slash}_`;
//       console.log(serialPrefix)
//       console.log(bitsId)
//       console.log(examDate.formatted)
//       const sampleQuery = new QueryCommand({
//         TableName: "wilp_marks",
//         IndexName: "RegisterNumber-SerialNumber-index",
//         KeyConditionExpression:
//           "#rn = :regNo AND begins_with(#sn, :coursePrefix)",
//         FilterExpression: "#ed = :examDate",
//         ExpressionAttributeNames: {
//           "#rn": "RegisterNumber",
//           "#sn": "SerialNumber",
//           "#ed": "ExamDate",
//         },
//         ExpressionAttributeValues: {
//           ":regNo": bitsId.toLowerCase(),
//           ":coursePrefix": serialPrefix,
//           ":examDate": examDate.formatted,
//         },
//       });

//       try {
//         const sampleData = await ddbClient.send(sampleQuery);
//         const items = sampleData.Items || [];
//         const totalMarks = items.reduce((sum, item) => {
//           const val = parseFloat(item.Marks);
//           return sum + (isNaN(val) ? 0 : val);
//         }, 0);

//         courseData.revaluationMarksSample = {
//           count: items.length,
//           totalMarks,
//           items,
//         };
//       } catch (err) {
//         console.error(
//           `❌ Revaluation_Marks_Sample error for ${courseCode}:`,
//           err.message
//         );
//         courseData.revaluationMarksSample = {
//           count: 0,
//           totalMarks: 0,
//           items: [],
//         };
//       }

//       // ✅ Add to final output
//       finalStudentData.courses[`course${courseIndex}`] = courseData;
//       finalStudentData.revaluationEligible.push({
//         courseCode: formattedCode,
//         examDate: examDate.formatted,
//         subject: courseData.subject,
//         fromDate: matchedRule.FromDate,
//         endDate: matchedRule.EndDate,
//       });

//       courseIndex++;
//     }

//     res.json(finalStudentData);
//   } catch (err) {
//     console.error("❌ Server error:", err);
//     res.status(500).json({ error: "Internal server error" });
//   }
// });


// router.post("/courses", authenticateJWT, async (req, res) => {
//   const bitsId = req.body.bitsId?.trim();
//   if (!bitsId) {
//     return res.status(400).json({ error: "BITS ID is required" });
//   }

//   const normalize = (str) => str?.replace(/\s+/g, "").trim().toUpperCase();
//   const formatCourseCode = (code) => {
//     const cleaned = code.replace(/\s+/g, "");
//     return cleaned.length > 4 ? cleaned.slice(0, 4) + " " + cleaned.slice(4) : cleaned;
//   };
//   const extractExamDate = (slot) => {
//     const dateMatch = slot?.match(/\d{2}\/\d{2}\/\d{4}/);
//     if (!dateMatch) return null;
//     const fullDate = dateMatch[0];
//     return {
//       formatted: fullDate.replace(/\//g, "-"),
//       slash: fullDate,
//       short: fullDate.replace(/\/20(\d{2})$/, "/$1"),
//     };
//   };

//   try {
//     const studentQuery = new QueryCommand({
//       TableName: process.env.TABLE2_NAME,
//       KeyConditionExpression: "#bitsId = :bitsId",
//       ExpressionAttributeNames: { "#bitsId": "BITS ID" },
//       ExpressionAttributeValues: { ":bitsId": bitsId },
//     });

//     const studentDataRaw = await ddbClient.send(studentQuery);

//     if (!studentDataRaw.Items || studentDataRaw.Items.length === 0) {
//       return res.status(404).json({ error: "Student not found" });
//     }

//     const student = studentDataRaw.Items[0];

//     const finalStudentData = {
//       bitsId: student["BITS ID"],
//       name: student["Name"],
//       programme: student["PROGRAMME"],
//       plan: student["Plan"],
//       examCity: student["Exam City"],
//       examCentre: student["Centre Name"],
//       phone: student["Phone No."],
//       bitsMail: student["BITS Mail Id"],
//       courses: {},
//       revaluationEligible: [],
//     };

//     const courseKeys = Object.keys(student).filter((k) => /^Course \d+$/.test(k));
//     const uniqueCourseCodes = Array.from(
//       new Set(courseKeys.map((k) => normalize(student[k])))
//     );

//     const courseMaster = [];
//     for (const courseCode of uniqueCourseCodes) {
//       const courseQuery = new QueryCommand({
//         TableName: process.env.TABLE1_NAME,
//         KeyConditionExpression: "#code = :code",
//         ExpressionAttributeNames: { "#code": "Course Code" },
//         ExpressionAttributeValues: { ":code": courseCode },
//       });
//       const result = await ddbClient.send(courseQuery);
//       if (result.Items?.length > 0) {
//         courseMaster.push(...result.Items);
//       }
//     }

//     let courseIndex = 1;

//     for (const courseKey of courseKeys) {
//       const courseCode = student[courseKey];
//       if (!courseCode) continue;

//       const indexNum = courseKey.split(" ")[1];
//       const slotKey = `Exam Slot.${indexNum}`;
//       const slot = student[slotKey];
//       if (!slot) continue;

//       const examDate = extractExamDate(slot);
//       if (!examDate) continue;

//       const revalQuery = new QueryCommand({
//         TableName: "PlanID_Course_Details",
//         IndexName: "Course-ExamDate-index",
//         KeyConditionExpression: "#course = :course AND #examDate = :examDate",
//         ExpressionAttributeNames: {
//           "#course": "Course",
//           "#examDate": "ExamDate",
//         },
//         ExpressionAttributeValues: {
//           ":course": normalize(courseCode),
//           ":examDate": examDate.short,
//         },
//       });

//       const ruleData = await ddbClient.send(revalQuery);
//       const matchedRule = ruleData.Items?.find(
//         (rule) =>
//           normalize(rule.Course) === normalize(courseCode) &&
//           rule.RevaluationFlag === "Yes"
//       );

//       if (!matchedRule) continue;

//       const courseDetails = courseMaster.find(
//         (c) => normalize(c["Course Code"]) === normalize(courseCode)
//       );

//       const courseData = {
//         code: courseCode,
//         examSlot: slot,
//         subject: courseDetails?.["Course Name"] || "-",
//         questionsCount: 0,
//         marksData: [],
//         revaluationMarksSample: [],
//       };

//       const formattedCode = formatCourseCode(courseCode);
//       const folderName = `${formattedCode}_${examDate.formatted}`;
//       const s3Key = `Question_bank/${folderName}/marks.csv`;

//       try {
//         const s3Params = { Bucket: "wilp-fr-model", Key: s3Key };
//         const s3Data = await s3Client.send(new GetObjectCommand(s3Params));
//         const csvString = await streamToString(s3Data.Body);
//         const rows = csvString.trim().split("\n").map((line) => line.split(","));
//         const computedCount = rows.length > 1 ? rows.length - 1 : 0;

//         if (computedCount > 0) {
//           courseData.questionsCount = computedCount;
//           courseData.marksData = rows.slice(1);
//         }
//       } catch (err) {
//         console.warn(`marks.csv error for ${s3Key}:`, err.message);
//       }

//       const serialPrefix = `${formattedCode}_${examDate.slash}_`;

//       const sampleQuery = new QueryCommand({
//         TableName: "wilp_marks",
//         IndexName: "RegisterNumber-SerialNumber-index",
//         KeyConditionExpression:
//           "#rn = :regNo AND begins_with(#sn, :coursePrefix)",
//         FilterExpression: "#ed = :examDate",
//         ExpressionAttributeNames: {
//           "#rn": "RegisterNumber",
//           "#sn": "SerialNumber",
//           "#ed": "ExamDate",
//         },
//         ExpressionAttributeValues: {
//           ":regNo": bitsId.toLowerCase(),
//           ":coursePrefix": serialPrefix,
//           ":examDate": examDate.formatted,
//         },
//       });

//       try {
//         const sampleData = await ddbClient.send(sampleQuery);
//         const items = sampleData.Items || [];
//         const totalMarks = items.reduce((sum, item) => {
//           const val = parseFloat(item.Marks);
//           return sum + (isNaN(val) ? 0 : val);
//         }, 0);

//         courseData.revaluationMarksSample = {
//           count: items.length,
//           totalMarks,
//           items,
//         };
//       } catch (err) {
//         console.error(`Revaluation_Marks_Sample error for ${courseCode}:`, err.message);
//       }

//       finalStudentData.courses[`course${courseIndex}`] = courseData;

//       // ✅ Add FromDate and EndDate to the response
//       finalStudentData.revaluationEligible.push({
//         courseCode: formattedCode,
//         examDate: examDate.formatted,
//         subject: courseData.subject,
//         fromDate: matchedRule.FromDate || null,
//         endDate: matchedRule.EndDate || null,
//       });

//       courseIndex++;
//     }

//     res.json(finalStudentData);
//   } catch (err) {
//     console.error("Server error:", err);
//     res.status(500).json({ error: "Internal server error" });
//   }
// });


router.post("/courses", authenticateJWT, async (req, res) => {
  const bitsId = req.body.bitsId?.trim();
  if (!bitsId) {
    return res.status(400).json({ error: "BITS ID is required" });
  }

  const normalize = (str) => str?.replace(/\s+/g, "").trim().toUpperCase();
  const formatCourseCode = (code) => {
    const cleaned = code.replace(/\s+/g, "");
    return cleaned.length > 4 ? cleaned.slice(0, 4) + " " + cleaned.slice(4) : cleaned;
  };
  const extractExamDate = (slot) => {
    const dateMatch = slot?.match(/\d{2}\/\d{2}\/\d{4}/);
    if (!dateMatch) return null;
    const fullDate = dateMatch[0];
    return {
      formatted: fullDate.replace(/\//g, "-"),
      slash: fullDate,
      short: fullDate.replace(/\/20(\d{2})$/, "/$1"),
    };
  };

  try {
    const studentQuery = new QueryCommand({
      TableName: process.env.TABLE2_NAME,
      KeyConditionExpression: "#bitsId = :bitsId",
      ExpressionAttributeNames: { "#bitsId": "BITSID" },
      ExpressionAttributeValues: { ":bitsId": bitsId },
    });

    const studentDataRaw = await ddbClient.send(studentQuery);

    if (!studentDataRaw.Items || studentDataRaw.Items.length === 0) {
      return res.status(404).json({ error: "Student not found" });
    }

    const student = studentDataRaw.Items[0];

    const finalStudentData = {
      bitsId: student["BITSID"],
      name: student["Name"],
      programme: student["Programme"],
      plan: student["Plan"],
      examCity: student["Exam City"] || "-",
      examCentre: student["Centre Name"] || "-",
      phone: student["Phone No."] || "-",
      bitsMail: student["BITS_MailId"],
      courses: {},
      revaluationEligible: [],
    };

    const courseKeys = Object.keys(student).filter((k) => /^Course\d+$/.test(k));
    const uniqueCourseCodes = Array.from(new Set(courseKeys.map((k) => normalize(student[k]))));

    const courseMaster = [];
    for (const courseCode of uniqueCourseCodes) {
      const courseQuery = new QueryCommand({
        TableName: process.env.TABLE1_NAME,
        KeyConditionExpression: "#code = :code",
        ExpressionAttributeNames: { "#code": "Course Code" },
        ExpressionAttributeValues: { ":code": courseCode },
      });
      const result = await ddbClient.send(courseQuery);
      if (result.Items?.length > 0) {
        courseMaster.push(...result.Items);
      }
    }

    let courseIndex = 1;

    for (const courseKey of courseKeys) {
      const courseCode = student[courseKey];
      if (!courseCode) continue;

      const indexNum = courseKey.replace("Course", "");
      const slotKey = `ExamSlot${indexNum}`;
      const slot = student[slotKey];
      if (!slot) continue;

      const examDate = extractExamDate(slot);
      if (!examDate) continue;

      const revalQuery = new QueryCommand({
        TableName: "PlanID_Course_Details",
        IndexName: "Course-ExamDate-index",
        KeyConditionExpression: "#course = :course AND #examDate = :examDate",
        ExpressionAttributeNames: {
          "#course": "Course",
          "#examDate": "ExamDate",
        },
        ExpressionAttributeValues: {
          ":course": normalize(courseCode),
          ":examDate": examDate.short,
        },
      });

      const ruleData = await ddbClient.send(revalQuery);
      const matchedRule = ruleData.Items?.find(
        (rule) =>
          normalize(rule.Course) === normalize(courseCode) &&
          rule.RevaluationFlag === "Yes"
      );

      if (!matchedRule) continue;

      const courseDetails = courseMaster.find(
        (c) => normalize(c["Course Code"]) === normalize(courseCode)
      );

      const courseNameKey = `Course${indexNum}_Name`;
      const subject = student[courseNameKey] || courseDetails?.["Course Name"] || "-";

      const courseData = {
        code: courseCode,
        examSlot: slot,
        subject,
        questionsCount: 0,
        marksData: [],
        revaluationMarksSample: [],
      };

      // ✅ Format course code as "ABC Z123"
      const splitZCourseCode = (() => {
        const cleaned = courseCode.replace(/\s+/g, "").toUpperCase();
        const zIndex = cleaned.indexOf("Z");
        return zIndex > 0
          ? cleaned.slice(0, zIndex) + " " + cleaned.slice(zIndex)
          : cleaned;
      })();

      const expectedFolderPrefix = `Question_bank/${splitZCourseCode}_${examDate.formatted}`;

      try {
        const listParams = {
          Bucket: "wilp-fr-model",
          Prefix: expectedFolderPrefix,
        };
        const listed = await s3Client.send(new ListObjectsV2Command(listParams));
        const key = listed.Contents?.find((obj) =>
          obj.Key.endsWith("marks.csv")
        )?.Key;

        if (key) {
          const s3Params = { Bucket: "wilp-fr-model", Key: key };
          const s3Data = await s3Client.send(new GetObjectCommand(s3Params));
          const csvString = await streamToString(s3Data.Body);
          const rows = csvString.trim().split("\n").map((line) => line.split(","));
          const computedCount = rows.length > 1 ? rows.length - 1 : 0;

          if (computedCount > 0) {
            courseData.questionsCount = computedCount;
            courseData.marksData = rows.slice(1);
          }
        } else {
          console.warn(`No marks.csv for ${splitZCourseCode}_${examDate.formatted}`);
        }
      } catch (err) {
        console.warn(`S3 error for ${courseCode} - ${examDate.formatted}:`, err.message);
      }

      const serialPrefix = `${splitZCourseCode}_${examDate.slash}_`;

      const sampleQuery = new QueryCommand({
        TableName: "wilp_marks",
        IndexName: "RegisterNumber-SerialNumber-index",
        KeyConditionExpression: "#rn = :regNo AND begins_with(#sn, :coursePrefix)",
        FilterExpression: "#ed = :examDate",
        ExpressionAttributeNames: {
          "#rn": "RegisterNumber",
          "#sn": "SerialNumber",
          "#ed": "ExamDate",
        },
        ExpressionAttributeValues: {
          ":regNo": bitsId.toLowerCase(),
          ":coursePrefix": serialPrefix.trim(),
          ":examDate": examDate.formatted,
        },
      });

      try {
        const sampleData = await ddbClient.send(sampleQuery);
        const items = sampleData.Items || [];
        const totalMarks = items.reduce((sum, item) => {
          const val = parseFloat(item.Marks);
          return sum + (isNaN(val) ? 0 : val);
        }, 0);

        courseData.revaluationMarksSample = {
          count: items.length,
          totalMarks,
          items,
        };
      } catch (err) {
        console.error(`Revaluation_Marks_Sample error for ${courseCode}:`, err.message);
      }

      finalStudentData.courses[`course${courseIndex}`] = courseData;

      finalStudentData.revaluationEligible.push({
        courseCode: formatCourseCode(normalize(courseCode)),
        examDate: examDate.formatted,
        subject: courseData.subject,
        fromDate: matchedRule.FromDate || null,
        endDate: matchedRule.EndDate || null,
      });

      courseIndex++;
    }

    res.json(finalStudentData);
  } catch (err) {
    console.error("Server error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});




// router.post("/courses", authenticateJWT, async (req, res) => {
//   const bitsId = req.body.bitsId?.trim();
//   if (!bitsId) {
//     return res.status(400).json({ error: "BITS ID is required" });
//   }

//   const normalize = (str) => str?.replace(/\s+/g, "").trim().toUpperCase();
//   const formatCourseCode = (code) => {
//     const cleaned = code.replace(/\s+/g, "");
//     return cleaned.length > 4 ? cleaned.slice(0, 4) + " " + cleaned.slice(4) : cleaned;
//   };
//   const extractExamDate = (slot) => {
//     const dateMatch = slot?.match(/\d{2}\/\d{2}\/\d{4}/);
//     if (!dateMatch) return null;
//     const fullDate = dateMatch[0];
//     return {
//       formatted: fullDate.replace(/\//g, "-"),
//       slash: fullDate,
//       short: fullDate.replace(/\/20(\d{2})$/, "/$1"),
//     };
//   };

//   try {
//     const studentQuery = new QueryCommand({
//       TableName: process.env.TABLE2_NAME,
//       KeyConditionExpression: "#bitsId = :bitsId",
//       ExpressionAttributeNames: { "#bitsId": "BITSID" },
//       ExpressionAttributeValues: { ":bitsId": bitsId },
//     });

//     const studentDataRaw = await ddbClient.send(studentQuery);

//     if (!studentDataRaw.Items || studentDataRaw.Items.length === 0) {
//       return res.status(404).json({ error: "Student not found" });
//     }

//     const student = studentDataRaw.Items[0];

//     const finalStudentData = {
//       bitsId: student["BITSID"],
//       name: student["Name"],
//       programme: student["Programme"],
//       plan: student["Plan"],
//       examCity: student["Exam City"] || "-", // fallback if field is missing
//       examCentre: student["Centre Name"] || "-", // fallback
//       phone: student["Phone No."] || "-", // fallback
//       bitsMail: student["BITS_MailId"],
//       courses: {},
//       revaluationEligible: [],
//     };

//     const courseKeys = Object.keys(student).filter((k) => /^Course\d+$/.test(k));
//     const uniqueCourseCodes = Array.from(
//       new Set(courseKeys.map((k) => normalize(student[k])))
//     );

//     const courseMaster = [];
//     for (const courseCode of uniqueCourseCodes) {
//       const courseQuery = new QueryCommand({
//         TableName: process.env.TABLE1_NAME,
//         KeyConditionExpression: "#code = :code",
//         ExpressionAttributeNames: { "#code": "Course Code" },
//         ExpressionAttributeValues: { ":code": courseCode },
//       });
//       const result = await ddbClient.send(courseQuery);
//       if (result.Items?.length > 0) {
//         courseMaster.push(...result.Items);
//       }
//     }

//     let courseIndex = 1;

//     for (const courseKey of courseKeys) {
//       const courseCode = student[courseKey];
//       if (!courseCode) continue;

//       const indexNum = courseKey.replace("Course", "");
//       const slotKey = `ExamSlot${indexNum}`;
//       const slot = student[slotKey];
//       if (!slot) continue;

//       const examDate = extractExamDate(slot);
//       if (!examDate) continue;

//       const revalQuery = new QueryCommand({
//         TableName: "PlanID_Course_Details",
//         IndexName: "Course-ExamDate-index",
//         KeyConditionExpression: "#course = :course AND #examDate = :examDate",
//         ExpressionAttributeNames: {
//           "#course": "Course",
//           "#examDate": "ExamDate",
//         },
//         ExpressionAttributeValues: {
//           ":course": normalize(courseCode),
//           ":examDate": examDate.short,
//         },
//       });

//       const ruleData = await ddbClient.send(revalQuery);
//       const matchedRule = ruleData.Items?.find(
//         (rule) =>
//           normalize(rule.Course) === normalize(courseCode) &&
//           rule.RevaluationFlag === "Yes"
//       );

//       if (!matchedRule) continue;

//       const courseDetails = courseMaster.find(
//         (c) => normalize(c["Course Code"]) === normalize(courseCode)
//       );

//       const courseNameKey = `Course${indexNum}_Name`;
//       const subject = student[courseNameKey] || courseDetails?.["Course Name"] || "-";

//       const courseData = {
//         code: courseCode,
//         examSlot: slot,
//         subject,
//         questionsCount: 0,
//         marksData: [],
//         revaluationMarksSample: [],
//       };

//       const formattedCode = formatCourseCode(courseCode);
//       const folderName = `${formattedCode}_${examDate.formatted}`;
//       const s3Key = `Question_bank/${folderName}/marks.csv`;

//       try {
//         const s3Params = { Bucket: "wilp-fr-model", Key: s3Key };
//         const s3Data = await s3Client.send(new GetObjectCommand(s3Params));
//         const csvString = await streamToString(s3Data.Body);
//         const rows = csvString.trim().split("\n").map((line) => line.split(","));
//         const computedCount = rows.length > 1 ? rows.length - 1 : 0;

//         if (computedCount > 0) {
//           courseData.questionsCount = computedCount;
//           courseData.marksData = rows.slice(1);
//         }
//       } catch (err) {
//         console.warn(`marks.csv error for ${s3Key}:`, err.message);
//       }

//       const serialPrefix = `${formattedCode}_${examDate.slash}_`;

//       const sampleQuery = new QueryCommand({
//         TableName: "wilp_marks",
//         IndexName: "RegisterNumber-SerialNumber-index",
//         KeyConditionExpression:
//           "#rn = :regNo AND begins_with(#sn, :coursePrefix)",
//         FilterExpression: "#ed = :examDate",
//         ExpressionAttributeNames: {
//           "#rn": "RegisterNumber",
//           "#sn": "SerialNumber",
//           "#ed": "ExamDate",
//         },
//         ExpressionAttributeValues: {
//           ":regNo": bitsId.toLowerCase(),
//           ":coursePrefix": serialPrefix,
//           ":examDate": examDate.formatted,
//         },
//       });

//       try {
//         const sampleData = await ddbClient.send(sampleQuery);
//         const items = sampleData.Items || [];
//         const totalMarks = items.reduce((sum, item) => {
//           const val = parseFloat(item.Marks);
//           return sum + (isNaN(val) ? 0 : val);
//         }, 0);

//         courseData.revaluationMarksSample = {
//           count: items.length,
//           totalMarks,
//           items,
//         };
//       } catch (err) {
//         console.error(`Revaluation_Marks_Sample error for ${courseCode}:`, err.message);
//       }

//       finalStudentData.courses[`course${courseIndex}`] = courseData;

//       finalStudentData.revaluationEligible.push({
//         courseCode: formattedCode,
//         examDate: examDate.formatted,
//         subject: courseData.subject,
//         fromDate: matchedRule.FromDate || null,
//         endDate: matchedRule.EndDate || null,
//       });

//       courseIndex++;
//     }

//     res.json(finalStudentData);
//   } catch (err) {
//     console.error("Server error:", err);
//     res.status(500).json({ error: "Internal server error" });
//   }
// });



router.post("/get-question-images", async (req, res) => {
  const { bitsId, courseCode, examDate } = req.body;
  console.log("📥 Request received with:", req.body);

  if (!bitsId || !courseCode || !examDate) {
    console.error("❌ Missing fields:", { bitsId, courseCode, examDate });
    return res.status(400).json({ error: "bitsId, courseCode, and examDate are required" });
  }

  // Normalize course code: remove spaces and uppercase
  const normalizedInputCode = courseCode.replace(/\s+/g, "").toUpperCase();

  // Split before Z (e.g., VLMWTZG632 → VLMWT + ZG632)
  const splitMatch = normalizedInputCode.match(/^(.*?)(Z[A-Z0-9]+)$/);
  if (!splitMatch) {
    return res.status(400).json({ error: "Invalid courseCode format" });
  }

  const prefixBeforeZ = splitMatch[1];     // e.g., "VLMWT"
  const coursePartFromZ = splitMatch[2];   // e.g., "ZG632"
  const spacedCourseCode = `${prefixBeforeZ} ${coursePartFromZ}`;  // e.g., "VLMWT ZG632"

  const folderName = `${spacedCourseCode}_${examDate}`;
  const s3Prefix = `Question_bank/${folderName}/questions/`;
  console.log(s3Prefix)

  // Function to format for response (VLMWT ZG632 → VLMW TZG632)
  const formatCourseCode = (code) => {
    const cleaned = code.replace(/\s+/g, "");
    return cleaned.length > 4
      ? cleaned.slice(0, 4) + " " + cleaned.slice(4)
      : cleaned;
  };

  try {
    // Step: List files directly in the built S3 folder
    const command = new ListObjectsV2Command({
      Bucket: "wilp-fr-model",
      Prefix: s3Prefix,
    });

    const data = await s3Client.send(command);

    const files = data.Contents?.filter((item) => item.Key !== s3Prefix)
      .map((item) => item.Key.replace(s3Prefix, ""))
      .filter((name) => name);

    if (!files || files.length === 0) {
      return res.status(404).json({ error: "No question images found in S3" });
    }

    const responsePayload = {
      bitsId,
      courseCode: formatCourseCode(spacedCourseCode),
      examDate,
      folder: `${folderName}/questions`,
      files,
      s3BaseUrl: `https://wilp-fr-model.s3.us-east-1.amazonaws.com/${encodeURIComponent(s3Prefix)}`,
    };

    console.log("✅ Final Response:", responsePayload);
    res.json(responsePayload);
  } catch (err) {
    console.error("🔥 Error listing questions from S3:", err);
    res.status(500).json({ error: "Could not list question images" });
  }
});


router.get("/test-s3-images", async (req, res) => {
  try {
    // Hardcoded test values
    const bitsId = "2024WV08014";
    const courseCode = "VLMWT ZG632";
    const examDate = "07-06-2025";

    // Hardcoded S3 folder (you can modify this if needed)
    const folderPrefix = `Question_bank/${courseCode}_${examDate}/questions/`;

    console.log("🔍 Testing S3 with folder:", folderPrefix);

    // List objects in S3 folder
    const command = new ListObjectsV2Command({
      Bucket: "wilp-fr-model",
      Prefix: folderPrefix,
    });

    const data = await s3Client.send(command);

    const files = data.Contents?.map((item) => item.Key.replace(folderPrefix, "")) || [];

    res.json({
      bitsId,
      courseCode,
      examDate,
      folder: folderPrefix,
      files,
      s3BaseUrl: `https://wilp-fr-model.s3.us-east-1.amazonaws.com/${encodeURIComponent(folderPrefix)}`,
    });
  } catch (err) {
    console.error("🔥 S3 Test Route Error:", err);
    res.status(500).json({ error: "Failed to fetch test images from S3" });
  }
});




// router.post("/get-question-images",async (req, res) => {
//   const { bitsId, courseCode, examDate } = req.body;

//   if (!bitsId || !courseCode || !examDate) {
//     return res
//       .status(400)
//       .json({ error: "bitsId, courseCode, and examDate are required" });
//   }

//   // Format course code with space if needed
//   const formatCourseCode = (code) => {
//     const cleaned = code.replace(/\s+/g, "");
//     return cleaned.length > 4
//       ? cleaned.slice(0, 4) + " " + cleaned.slice(4)
//       : cleaned;
//   };

//   const formattedCode = formatCourseCode(courseCode);
//   const folder = `${formattedCode}_${examDate}`;

//   const prefix = `Question_bank/${folder}/questions/`;
//   console.log(`Searching: ${prefix}`);

//   try {
//     const command = new ListObjectsV2Command({
//       Bucket: "wilp-fr-model",
//       Prefix: prefix,
//     });

//     const data = await s3Client.send(command);

//     const files = data.Contents?.filter((item) => item.Key !== prefix) // skip folder itself
//       .map((item) => item.Key.replace(prefix, ""))
//       .filter((name) => name); // remove empty strings

//     res.json({
//       bitsId,
//       courseCode: formattedCode,
//       examDate,
//       folder: `${folder}/questions`,
//       files,
//       s3BaseUrl: `https://wilp-fr-model.s3.us-east-1.amazonaws.com/${encodeURIComponent(
//         `Question_bank/${folder}/questions/`
//       )}`,
//     });
//   } catch (err) {
//     console.error("Error listing questions:", err);
//     res.status(500).json({ error: "Could not list question images" });
//   }
// });

router.post("/question-paper-details/filter", async (req, res) => {
  try {
    const { courseCode, examDate } = req.body;

    if (!courseCode || !examDate) {
      return res
        .status(400)
        .json({ error: "courseCode and examDate are required." });
    }

    function formatCourseCode(code) {
      // Remove all spaces first
      let cleaned = code.replace(/\s+/g, "");
      // Insert space at position 4 if it matches your pattern
      if (cleaned.length > 4) {
        return cleaned.slice(0, 4) + " " + cleaned.slice(4);
      }
      return cleaned;
    }

    // ⚡ Clean up any trailing spaces to match stored keys
    const cleanCourseCode = formatCourseCode(courseCode.trim());
    const cleanExamDate = examDate.trim();

    // Combine to match your partition key format
    const uniqueId = `${cleanCourseCode}_${cleanExamDate}`;

    console.log(`Searching for unique_id: ${uniqueId}`);

    // Build the QueryCommand
    const command = new QueryCommand({
      TableName: "Question_Paper_Details",
      KeyConditionExpression: "#uid = :uid",
      ExpressionAttributeNames: {
        "#uid": "unique_id",
      },
      ExpressionAttributeValues: {
        ":uid": uniqueId,
      },
    });

    const data = await ddbClient.send(command);

    if (!data.Items || data.Items.length === 0) {
      return res
        .status(404)
        .json({
          message: "No question paper found for given courseCode and examDate.",
        });
    }

    // Unmarshall results to plain JSON
    const items = data.Items.map((item) => unmarshall(item));

    res.json(items);
  } catch (err) {
    console.error("Error querying Question_Paper_Details:", err);
    res
      .status(500)
      .json({
        error: "Internal server error while fetching question paper details.",
      });
  }
});

router.post("/get-question-bank-marks", async (req, res) => {
  const { courseCode, studentId, examDate } = req.body;

  if (!courseCode || !studentId || !examDate) {
    return res
      .status(400)
      .json({ error: "Missing courseCode, studentId, or examDate" });
  }

  const spacedCourseCode = courseCode.slice(0, 4) + " " + courseCode.slice(4);
  const folder = `${spacedCourseCode}_${examDate}`;

  const key = `Question_bank/${folder}/marks.csv`;

  console.log(`Fetching file: ${key}`);

  try {
    const command = new GetObjectCommand({
      Bucket: "wilp-fr-model",
      Key: key,
    });

    const data = await s3Client.send(command);
    const csvContent = await streamToString(data.Body);
    const rows = csvContent.trim().split("\n");
    const rowCount = rows.length - 1;

    res.json({
      studentId,
      courseCode,
      examDate,
      questionCount: rowCount - 1,
      folder,
      s3Key: key,
    });
  } catch (err) {
    console.error("Error fetching marks.csv:", err);
    res.status(500).json({ error: `Could not fetch ${key}` });
  }
});

function normalizeToIso(dateStr) {
  const [p1, p2, p3] = dateStr.split(/[-/]/);
  const dd = p1.padStart(2, "0");
  const mm = p2.padStart(2, "0");
  const yyyy = p3;
  return `${yyyy}-${mm}-${dd}`;
}

function formatCourseCode(rawCode) {
  if (!rawCode) return "";
  const cleaned = rawCode.replace(/\s+/g, "");
  if (cleaned.length > 4) {
    return cleaned.slice(0, 4) + " " + cleaned.slice(4);
  }
  return cleaned;
}


router.post("/getStudentAnswerFolder", async (req, res) => {
  try {
    const { registerNumber, courseCode, examDate } = req.body;

    if (!registerNumber || !courseCode || !examDate) {
      return res.status(400).json({ error: "Missing required fields." });
    }

    const isoDate = normalizeToIso(examDate);
    const inputCode = (courseCode || "").replace(/\s+/g, "").toUpperCase();

    const parentPrefix = `Exam-answers/${registerNumber.toLowerCase()}/${isoDate}/`;

    const list = await s3Client.send(
      new ListObjectsV2Command({
        Bucket: process.env.S3_BUCKET_NAME || "wilp-fr-model",
        Prefix: parentPrefix,
        Delimiter: "/",
      })
    );

    const allPrefixes = list.CommonPrefixes || [];

    // Find a matching folder where the name (without space) matches input
    const match = allPrefixes.find((prefixObj) => {
      const folderPath = prefixObj.Prefix;
      const folderName = folderPath.replace(parentPrefix, "").replace(/\/$/, "");
      const normalized = folderName.replace(/\s+/g, "").toUpperCase();
      return normalized === inputCode;
    });

    if (!match) {
      return res.status(404).json({ error: "Folder not found for course code." });
    }

    const matchingPrefix = match.Prefix;

    // Now list objects inside the matched folder
    const fileList = await s3Client.send(
      new ListObjectsV2Command({
        Bucket: process.env.S3_BUCKET_NAME || "wilp-fr-model",
        Prefix: matchingPrefix,
      })
    );

    const files = fileList.Contents
      ? fileList.Contents.map((o) => o.Key.replace(matchingPrefix, ""))
      : [];

    return res.json({
      files,
      folder: matchingPrefix,
    });

  } catch (err) {
    console.error("Error in getStudentAnswerFolder:", err);
    return res.status(500).json({ error: "Internal server error." });
  }
});



// router.post("/getStudentAnswerFolder",async (req, res) => {
//   try {
//     const { registerNumber, courseCode, examDate } = req.body;
//     if (!registerNumber || !courseCode || !examDate) {
//       return res.status(400).json({ error: "Missing required fields." });
//     }

//     // normalize inputs
//     const isoDate = normalizeToIso(examDate);
//     const formatted = formatCourseCode(courseCode);
//     const prefix = `Exam-answers/${registerNumber.toLowerCase()}/${isoDate}/${formatted}/`;
    
//     console.log(prefix);
//     // list all objects under that prefix
//     const list = await s3Client.send(
//       new ListObjectsV2Command({
//         Bucket: process.env.S3_BUCKET_NAME || "wilp-fr-model",
//         Prefix: prefix,
//       })
//     );

//     // strip off the prefix to get just filenames
//     const files = list.Contents
//       ? list.Contents.map((o) => o.Key.replace(prefix, ""))
//       : [];
//     console.log(files);
//     // return only the files array
//     return res.json({
//       files,
//       folder: prefix, // add this
//     });
//   } catch (err) {
//     console.error("Error in getStudentAnswerFolder:", err);
//     return res.status(500).json({ error: "Internal server error." });
//   }
// });

router.post("/reevaluation/apply", async (req, res) => {
  try {
    const {
      SerialNumber,
      RegisterNumber,
      Status,
      Comment,
      CourseNo,
      CourseTitle,
      ExamDate,
      Marks,
      MaxMarks,
      QuestionNo,
    } = req.body;

    // Validate required fields
    if (
      !SerialNumber ||
      !RegisterNumber ||
      !Status ||
      !CourseNo ||
      !CourseTitle ||
      !ExamDate ||
      Marks === undefined || // Allow 0
      MaxMarks === undefined ||
      !QuestionNo
    ) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    // Format current datetime
    const now = new Date();
    const dd = String(now.getDate()).padStart(2, "0");
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const yyyy = now.getFullYear();
    const hh = String(now.getHours()).padStart(2, "0");
    const min = String(now.getMinutes()).padStart(2, "0");
    const ss = String(now.getSeconds()).padStart(2, "0");
    const formattedDateTime = `${dd}-${mm}-${yyyy} ${hh}:${min}:${ss}`;

    // Build final item
    const item = {
      SerialNumber: { S: SerialNumber },
      RegisterNumber: { S: RegisterNumber.toLowerCase() },
      Status: { S: Status },
      StudentComment: { S: Comment || "" },
      // AppDateTime: { S: formattedDateTime },
      CourseNo: { S: CourseNo },
      CourseTitle: { S: CourseTitle },
      ExamDate: { S: ExamDate },
      Marks: { N: String(Marks) },
      MaxMarks: { N: String(MaxMarks) },
      QuestionNo: { S: QuestionNo },
      DateTime: { S: formattedDateTime }, // If you want both DateTime & AppDateTime
    };

    const putCmd = new PutItemCommand({
      TableName: "Student_Reevaluation_Details",
      Item: item,
    });

    await ddbClient.send(putCmd);

    res.json({ success: true, item });
  } catch (err) {
    console.error("DynamoDB put error:", err);
    res.status(500).json({ error: "Failed to store re-evaluation request" });
  }
});

module.exports = router;
