const express = require("express");
const cors = require("cors");
const { exec, spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const { default: axios } = require("axios");


const app = express();
const PORT = 3006;

app.use(cors());
app.use(express.json());

const getOpenVPNPath = () => {
    return new Promise((resolve, reject) => {
        exec("which openvpn", (error, stdout) => {
            if (error || !stdout) {
                return reject("Could not find OpenVPN in system PATH.");
            }
            resolve(stdout.trim());
        });
    });
};

const addSudoersEntry = async (username, openvpnPath) => {
    const sudoersFile = "/etc/sudoers";
    const entry = `${username} ALL=(ALL) NOPASSWD: ${openvpnPath}\n`;

    try {
        const fileContent = fs.readFileSync(sudoersFile, "utf8");
        if (fileContent.includes(entry)) {
            console.log("Entry already exists in sudoers file.");
            return;
        }

        fs.appendFileSync(sudoersFile, entry);
        console.log("Successfully added the entry to sudoers file.");
    } catch (error) {
        throw new Error("Error updating sudoers file: " + error.message);
    }
};

const startVPN = async (configFile) => {
    const openvpnPath = await getOpenVPNPath();
    const configPath = path.resolve(__dirname, "configs", configFile);

    if (!fs.existsSync(configPath)) {
        throw new Error(`Configuration file not found: ${configPath}`);
    }

    return new Promise((resolve, reject) => {
        const vpnProcess = spawn("sudo", [openvpnPath, "--config", configPath]);

        vpnProcess.stdout.on("data", (data) => {
            console.log(`VPN Output: ${data}`);
        });

        vpnProcess.stderr.on("data", (data) => {
            console.error(`VPN Error: ${data}`);
        });

        vpnProcess.on("close", (code) => {
            if (code === 0) {
                resolve("VPN started successfully!");
            } else {
                reject(`VPN process exited with code ${code}`);
            }
        });
    });
};


app.get('/add-sudoers', async (req, res) => {
    const username = require('os').userInfo().username;
  
    try {
      const openvpnPath = await getOpenVPNPath();
      await addSudoersEntry(username, openvpnPath);
      res.status(200).send('Sudoers entry added successfully!');
    } catch (err) {
      res.status(500).send(err.message);
    }
  });
  


  const stopVPN = () => {
    return new Promise((resolve, reject) => {
        exec("sudo /usr/bin/killall openvpn", (error, stdout, stderr) => {
            if (error) {
                console.error("Error stopping VPN:", stderr || error.message);
                return reject(new Error(stderr || error.message));
            }
            console.log("VPN stopped successfully:", stdout);
            resolve("VPN stopped successfully!");
        });
    });
};

// Endpoint to stop the VPN
app.post('/stop', async (req, res) => {
    try {
          const message = await stopVPN();
        res.status(200).json({ message });
    } catch (error) {
        console.error("Failed to stop VPN:", error.message);
        res.status(500).json({ error: error.message });
    }
});

app.post("/start/:location", async (req, res) => {
    const location = req.params.location;
    const configMap = {
        france: "franceclient.ovpn",
        usa: "usanewclient.ovpn",
        uk: "uknewclient.ovpn",
        australia: "australiaclient.ovpn",
        uae: "uaenewclient.ovpn",
    };

    const configFile = configMap[location];
    if (!configFile) {
        return res.status(400).json({ error: "Invalid location" });
    }

    try {
        const message = await startVPN(configFile);
        res.status(200).json({ message });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});



app.get('/vpn-status', checkVpnStatus);


app.get('/ip-info', async (req, res) => {
    try {
        const response = await axios.get('https://ipinfo.io/json');
        if (response.status === 200) {
            const ipInfo = response.data;
            res.json(ipInfo);
        } else {
            console.error(`Non-success status from IPInfo API: ${response.status}`);
            res.status(500).send(`IPInfo API error: ${response.status}`);
        }
    } catch (error) {
        console.error(`Failed to fetch IP info: ${error.message}`);
        res.status(500).send(`Failed to fetch IP info: ${error.message}`);
    }
});




function getVpnRealStatus() {
    return new Promise((resolve, reject) => {
        exec("ps aux | grep openvpn | grep -v grep", (error, stdout, stderr) => {
            if (error) {
                reject("Failed to execute ps command: " + stderr);
                return;
            }
            
            if (stdout.trim() !== "") {
                resolve(true);
                return;
            }
            
            exec("route -n get default", (routeError, routeStdout, routeStderr) => {
                if (routeError) {
                    reject("Failed to execute route command: " + routeStderr);
                    return;
                }
                
                if (routeStdout.includes("utun") || routeStdout.includes("tun") || routeStdout.includes("ppp")) {
                    resolve(true);
                } else {
                    resolve(false);
                }
            });
        });
    });
}

// Function to check VPN status and respond
async function checkVpnStatus(req, res) {
    try {
        const vpnStatus = await getVpnRealStatus();
        if (vpnStatus) {
            res.status(200).send("VPN is active");
        } else {
            res.status(200).send("No VPN is active");
        }
    } catch (error) {
        res.status(500).send("Error checking VPN status: " + error);
    }
}




app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
