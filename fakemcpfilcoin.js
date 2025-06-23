import express from "express";
import lighthouse from "@lighthouse-web3/sdk";
import dotenv from "dotenv";
import { v4 as uuidv4 } from "uuid";

dotenv.config();

// --- In-memory Stores ---
// In a production app, you would use a database (e.g., SQLite, Postgres, MongoDB).
const contentStore = {};
const pendingPayments = {};

// --- Configuration ---
// This is your server's wallet address where you will receive FIL payments.
// IMPORTANT: Replace this with your actual Filecoin wallet address.
const RECIPIENT_FIL_ADDRESS = "f1..."; // e.g., f1abc...
const FIL_PRICE_PER_CONTENT = 0.001; // Price in FIL

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// This endpoint is called by your WordPress plugin to register and store content.
app.post("/api/send", async (req, res) => {
  console.log("POST request received:", req.body);
  const { content, wallet_address, url, title } = req.body;

  if (!content || !wallet_address || !url || !title) {
    return res.status(400).json({ error: "Missing required fields." });
  }

  try {
    const apiKey = process.env.LIGHTHOUSE_API_KEY;
    if (!apiKey) {
      console.error("LIGHTHOUSE_API_KEY is not set.");
      return res
        .status(500)
        .json({ error: "Server configuration error: Missing API Key." });
    }

    const response = await lighthouse.uploadText(content, apiKey, title);
    console.log("Lighthouse Response:", response);
    const ipfsHash = response.data.Hash;

    contentStore[url] = {
      ipfsHash: ipfsHash,
      ownerWallet: wallet_address,
      title: title,
      priceFIL: FIL_PRICE_PER_CONTENT,
      uploadTimestamp: new Date().toISOString(),
    };

    console.log("Stored metadata for:", url, contentStore[url]);

    res
      .status(200)
      .json({ message: "Content monetized successfully!", data: response.data });
  } catch (error) {
    console.error("Error processing /api/send:", error);
    res.status(500).json({
      error: "Failed to monetize content.",
      details: error.message,
    });
  }
});

// --- MCP Endpoint Step 1: Request Payment Details ---
// The AI Agent calls this first to get instructions on how to pay.
app.get("/api/mcp/request-payment", (req, res) => {
  const contentUrl = req.query.url;
  if (!contentUrl || !contentStore[contentUrl]) {
    return res.status(404).json({ error: "Content not found for this URL." });
  }

  const paymentId = uuidv4();
  const priceFIL = contentStore[contentUrl].priceFIL;

  // Store the payment details to be verified later
  pendingPayments[paymentId] = {
    contentUrl,
    priceFIL,
    timestamp: Date.now(),
  };

  res.status(200).json({
    message: "Payment required to access content.",
    paymentId: paymentId,
    recipientAddress: RECIPIENT_FIL_ADDRESS,
    amount: priceFIL,
    currency: "FIL",
  });
});

// --- MCP Endpoint Step 2: Get Content with Payment Proof ---
// After paying, the AI Agent calls this endpoint with proof.
app.get("/api/mcp/get-content", async (req, res) => {
  const { paymentId, txHash } = req.query;

  if (!paymentId || !txHash) {
    return res
      .status(400)
      .json({ error: "paymentId and txHash query parameters are required." });
  }

  const paymentInfo = pendingPayments[paymentId];
  if (!paymentInfo) {
    return res.status(404).json({ error: "Invalid or expired paymentId." });
  }

  try {
    const isValidPayment = await verifyFilecoinPayment(
      txHash,
      paymentInfo.priceFIL,
      RECIPIENT_FIL_ADDRESS
    );

    if (isValidPayment) {
      const contentInfo = contentStore[paymentInfo.contentUrl];
      
      // Prevent this paymentId from being used again
      delete pendingPayments[paymentId];
      
      res.status(200).json({
        message: "Payment verified! Access granted.",
        data: {
          requestedUrl: paymentInfo.contentUrl,
          ...contentInfo,
          // In a real implementation, you would fetch the full content from IPFS:
          // content: await fetch(`https://gateway.lighthouse.storage/ipfs/${contentInfo.ipfsHash}`).then(res => res.text())
        },
      });
    } else {
      res.status(402).json({ error: "Payment verification failed." });
    }
  } catch (error) {
    console.error("Verification error:", error);
    res.status(500).json({ error: "Error during payment verification." });
  }
});

/**
 * Verifies a Filecoin transaction using the Filfox block explorer API.
 * In a production environment, you might want to run your own node for higher reliability.
 * @param {string} txHash The Filecoin message CID (transaction hash).
 * @param {number} expectedAmount The expected amount in FIL.
 * @param {string} expectedRecipient The wallet address that should have received the payment.
 * @returns {Promise<boolean>} True if the payment is valid, false otherwise.
 */
async function verifyFilecoinPayment(
  txHash,
  expectedAmount,
  expectedRecipient
) {
  // This is a placeholder for a real transaction hash for demonstration.
  // The AI agent would provide the actual hash from its payment.
  console.log(`Verifying tx: ${txHash} for ${expectedAmount} FIL to ${expectedRecipient}`);
  
  // For the hackathon demo, we can use a mock verification.
  // To make this real, uncomment the code below.
  if (process.env.NODE_ENV !== 'production') {
    console.log("DEV MODE: Skipping real transaction verification. Returning true.");
    return true; 
  }

  /*
  // --- REAL IMPLEMENTATION ---
  try {
    const url = `https://filfox.info/api/v1/message/${txHash}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Filfox API returned status: ${response.status}`);
    }
    const txDetails = await response.json();

    // Filecoin amounts are in attoFIL (10^18), so we need to convert.
    const amountInFIL = Number(txDetails.value) / 1e18;

    if (txDetails.to === expectedRecipient && amountInFIL >= expectedAmount) {
      console.log("Transaction verified successfully on-chain.");
      return true;
    } else {
      console.log("Transaction details do not match.", {
        ExpectedTo: expectedRecipient,
        ActualTo: txDetails.to,
        ExpectedAmount: expectedAmount,
        ActualAmount: amountInFIL,
      });
      return false;
    }
  } catch (error) {
    console.error("Error contacting Filfox API:", error);
    return false;
  }
  */
}

app.listen(3000, () => {
  console.log("Filecoin MCP Server is running on port 3000");
});
