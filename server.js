const express = require('express');
const cors = require('cors');
const multer = require('multer');
const axios = require('axios');
const FormData = require('form-data');
require('dotenv').config();

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const ACCESS_KEY = process.env.ACCESS_KEY || 'ak_4d3c90f6836a4f21ba91e09b162fa0b8';
const SECRET_KEY = process.env.SECRET_KEY || 'sk_c133bed7f8564791bbc5185c6f4b880e';
const BASE_URL = 'https://api.hitem3d.ai';

let cachedToken = null;
let tokenExpiry = 0;

async function getAccessToken() {
  if (cachedToken && Date.now() < tokenExpiry) {
    return cachedToken;
  }

  const credentials = Buffer.from(`${ACCESS_KEY}:${SECRET_KEY}`).toString('base64');
 
  const response = await axios.post(`${BASE_URL}/open-api/v1/auth/token`, {}, {
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Content-Type': 'application/json'
    }
  });

  const tokenData = response.data?.data || response.data;
  const accessToken = tokenData?.accessToken || tokenData?.access_token || tokenData?.token;
 
  if (!accessToken) {
    throw new Error('Failed to obtain access token from auth API.');
  }

  cachedToken = accessToken;
  tokenExpiry = Date.now() + 3500 * 1000;
  return cachedToken;
}

app.post('/api/generate-3d', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No image uploaded.' });
    }

    const accessToken = await getAccessToken();

    const form = new FormData();
    form.append('images', req.file.buffer, {
      filename: req.file.originalname || 'upload.jpg',
      contentType: req.file.mimetype
    });
   
    // Explicit geometry + texture generation parameters
    form.append('request_type', '3');
    form.append('model_version', 'hi3dv3.0');

    console.log("Submitting 3D generation task...");
    const taskRes = await axios.post(`${BASE_URL}/open-api/v1/submit-task`, form, {
      headers: {
        ...form.getHeaders(),
        'Authorization': `Bearer ${accessToken}`
      }
    });

    console.log("RAW API RESPONSE:", JSON.stringify(taskRes.data));

    const resData = taskRes.data?.data || taskRes.data;
    const taskId = resData?.task_id || resData?.taskId || resData?.id;

    if (!taskId) {
      throw new Error(`Failed to retrieve task ID. Response: ${JSON.stringify(taskRes.data)}`);
    }

    res.json({ success: true, taskId });
  } catch (error) {
    console.error('Submission Error Details:', error.response?.data || error.message);
    res.status(500).json({
      success: false,
      error: error.response?.data?.msg || error.response?.data?.message || error.message || 'Generation failed.'
    });
  }
});

app.get('/api/task-status/:taskId', async (req, res) => {
  try {
    const { taskId } = req.params;
    const accessToken = await getAccessToken();

    const statusRes = await axios.get(`${BASE_URL}/open-api/v1/query-task?task_id=${taskId}`, {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });

    const data = statusRes.data?.data || statusRes.data;
    const status = data?.status;
    const queuePosition = data?.queue_position !== undefined ? data.queue_position : null;

    if (status === 'success' || status === 'COMPLETED' || status === 'completed') {
      return res.json({
        success: true,
        status: 'success',
        modelUrl: data?.output?.pbr_model || data?.output?.model || data?.model_url || data?.file_url || data?.output?.file_url
      });
    } else if (status === 'failed' || status === 'FAILED' || status === 'error') {
      return res.json({ success: true, status: 'failed' });
    }

    res.json({
      success: true,
      status: status || 'processing',
      queuePosition
    });
  } catch (error) {
    console.error('Polling Error:', error.response?.data || error.message);
    res.status(500).json({ success: false, error: 'Polling error.' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
