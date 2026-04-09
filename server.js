import express from "express";
import sqlite3 from "sqlite3";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { body, param, validationResult } from "express-validator";
import crypto from "crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

// Middleware
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
            fontSrc: ["'self'", "https://fonts.gstatic.com"],
            scriptSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", "data:", "blob:"],
        },
    },
}));
app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.static(path.join(__dirname, "public")));

const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 200,
    message: "Too many requests, please try again later.",
});
app.use("/api/", limiter);

app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
    next();
});

// Database
const dbPath = path.join(__dirname, "database.sqlite");
const db = new sqlite3.Database(dbPath);

const dbGet = (sql, params = []) =>
    new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
    });

const dbRun = (sql, params = []) =>
    new Promise((resolve, reject) => {
        db.run(sql, params, function (err) {
            if (err) reject(err);
            else resolve(this);
        });
    });

const dbAll = (sql, params = []) =>
    new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
    });

// Init DB
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        paidUntil INTEGER DEFAULT 0,
        freeAttempts INTEGER DEFAULT 3,
        createdAt INTEGER DEFAULT (strftime('%s','now'))
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS scans (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        userId TEXT NOT NULL,
        score REAL,
        details TEXT,
        timestamp INTEGER,
        imagePreview TEXT,
        recommendations TEXT
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        userId TEXT NOT NULL,
        amount REAL,
        date INTEGER,
        transactionId TEXT
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS promo_codes (
        code TEXT PRIMARY KEY,
        durationDays INTEGER DEFAULT 30,
        maxUses INTEGER DEFAULT 1,
        usedCount INTEGER DEFAULT 0,
        expiresAt INTEGER NOT NULL DEFAULT 0
    )`);

    // Вставка тестовых промокодов (если их ещё нет)
    const stmt = db.prepare(`INSERT OR IGNORE INTO promo_codes (code, durationDays, maxUses, expiresAt) VALUES (?, ?, ?, ?)`);
    const future = Date.now() + 365 * 24 * 60 * 60 * 1000;
    stmt.run("LOOKSMAX", 30, 100, future);
    stmt.run("FREEPRO", 30, 50, future);
    stmt.run("PRO2025", 30, 10, future);
    stmt.finalize();
});

// Validation
const validate = (validations) => async (req, res, next) => {
    await Promise.all(validations.map((v) => v.run(req)));
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }
    next();
};

// Admin middleware
const ADMIN_API_KEY = process.env.ADMIN_API_KEY || "change-me-in-production";
const adminAuth = (req, res, next) => {
    const key = req.headers["x-api-key"];
    if (key !== ADMIN_API_KEY) {
        return res.status(401).json({ error: "Unauthorized" });
    }
    next();
};

// AI simulation
function simulateAIAnalysis(imageBase64) {
    const hash = crypto.createHash('md5').update(imageBase64).digest('hex');
    const seed = parseInt(hash.substring(0, 8), 16) / 0xffffffff;

    const base = (val) => Math.min(98, Math.max(38, val + (seed - 0.5) * 25));

    const symmetry = base(70 + (seed * 20 - 10));
    const skinQuality = base(65 + (seed * 25 - 5));
    const boneStructure = base(60 + (seed * 30 - 5));
    const eyeArea = base(75 + (seed * 15 - 10));
    const jawline = base(55 + (seed * 35 - 10));
    const hairQuality = base(68 + (seed * 22 - 8));
    const harmony = base(72 + (seed * 18 - 12));

    const metrics = {
        symmetry: parseFloat(symmetry.toFixed(1)),
        skinQuality: parseFloat(skinQuality.toFixed(1)),
        boneStructure: parseFloat(boneStructure.toFixed(1)),
        eyeArea: parseFloat(eyeArea.toFixed(1)),
        jawline: parseFloat(jawline.toFixed(1)),
        hairQuality: parseFloat(hairQuality.toFixed(1)),
        harmony: parseFloat(harmony.toFixed(1)),
    };

    const weights = { symmetry: 0.2, skinQuality: 0.15, boneStructure: 0.2, eyeArea: 0.15, jawline: 0.15, hairQuality: 0.05, harmony: 0.1 };
    let weightedSum = 0, totalWeight = 0;
    for (let k in weights) {
        weightedSum += metrics[k] * weights[k];
        totalWeight += weights[k];
    }
    let rawScore = weightedSum / totalWeight;
    const score = parseFloat((4 + (rawScore / 100) * 6).toFixed(1));

    const recommendations = generateRecommendations(metrics);
    return { score, metrics, recommendations };
}

function generateRecommendations(metrics) {
    const tips = [];
    const weakThreshold = 65;
    if (metrics.symmetry < weakThreshold) tips.push("🧘 Упражнения для симметрии лица: жуйте жвачку поочерёдно на обеих сторонах, делайте массаж лица гуаша.");
    if (metrics.skinQuality < weakThreshold) tips.push("💧 Уход за кожей: используйте ретинол, витамин С, увлажнение и SPF 50 ежедневно.");
    if (metrics.boneStructure < weakThreshold) tips.push("🦷 Ортодонтия: возможно, стоит проконсультироваться с ортодонтом для улучшения прикуса и структуры челюсти.");
    if (metrics.eyeArea < weakThreshold) tips.push("👁️ Уход за областью глаз: кремы с кофеином, массаж для уменьшения отёков, упражнения для век.");
    if (metrics.jawline < weakThreshold) tips.push("💪 Челюсть: жевание твёрдой пищи, мьюинг (правильное положение языка), упражнения для подбородка.");
    if (metrics.hairQuality < weakThreshold) tips.push("💇 Уход за волосами: маски, массаж кожи головы, подбор подходящей стрижки по форме лица.");
    if (metrics.harmony < weakThreshold) tips.push("⚖️ Гармония лица: сбалансируйте пропорции с помощью стрижки, бороды или макияжа.");
    if (tips.length === 0) tips.push("🌟 Ваше лицо гармонично! Поддерживайте текущий уход и здоровый образ жизни.");
    else tips.push("📌 Дополнительно: здоровый сон, питьевой режим и снижение стресса улучшат общее состояние.");
    return tips;
}

// Endpoints
app.get(
    "/api/user/:id",
    validate([param("id").isString().isLength({ min: 3, max: 64 })]),
    async (req, res) => {
        try {
            const { id } = req.params;
            await dbRun("INSERT OR IGNORE INTO users (id, paidUntil, freeAttempts) VALUES (?,0,3)", [id]);
            const row = await dbGet("SELECT * FROM users WHERE id=?", [id]);
            res.json({
                pro: row.paidUntil > Date.now(),
                attempts: row.freeAttempts,
                paidUntil: row.paidUntil,
            });
        } catch (e) {
            console.error(e);
            res.status(500).json({ error: "Internal server error" });
        }
    }
);

app.post(
    "/api/analyze",
    validate([body("userId").isString().notEmpty()]),
    async (req, res) => {
        try {
            const { userId } = req.body;
            const row = await dbGet("SELECT * FROM users WHERE id=?", [userId]);
            if (!row) {
                return res.status(404).json({ success: false, message: "User not found" });
            }
            const isPro = row.paidUntil > Date.now();
            if (!isPro && row.freeAttempts <= 0) {
                return res.json({
                    success: false,
                    message: "Free scan limit reached. Activate PRO to continue.",
                });
            }

            await dbRun("BEGIN IMMEDIATE");
            if (!isPro) {
                await dbRun("UPDATE users SET freeAttempts = freeAttempts - 1 WHERE id = ?", [userId]);
            }
            const updated = await dbGet("SELECT * FROM users WHERE id=?", [userId]);
            await dbRun("COMMIT");

            res.json({
                success: true,
                isPro,
                attemptsLeft: isPro ? -1 : updated.freeAttempts,
            });
        } catch (e) {
            await dbRun("ROLLBACK");
            console.error(e);
            res.status(500).json({ error: "Internal server error" });
        }
    }
);

app.post(
    "/api/scan",
    validate([
        body("userId").isString().notEmpty(),
        body("imageBase64").isString().notEmpty(),
    ]),
    async (req, res) => {
        try {
            const { userId, imageBase64 } = req.body;
            if (!imageBase64 || imageBase64.length < 100) {
                return res.status(400).json({ error: "Invalid image data" });
            }

            const { score, metrics, recommendations } = simulateAIAnalysis(imageBase64);

            const result = await dbRun(
                "INSERT INTO scans (userId, score, details, timestamp, imagePreview, recommendations) VALUES (?, ?, ?, ?, ?, ?)",
                [userId, score, JSON.stringify(metrics), Date.now(), imageBase64, JSON.stringify(recommendations)]
            );
            res.json({
                success: true,
                scanId: result.lastID,
                score,
                metrics,
                recommendations,
            });
        } catch (e) {
            console.error(e);
            res.status(500).json({ error: "Internal server error" });
        }
    }
);

app.get(
    "/api/history/:userId",
    validate([
        param("userId").isString().notEmpty(),
        query("page").optional().isInt({ min: 1 }).toInt(),
        query("limit").optional().isInt({ min: 1, max: 50 }).toInt(),
    ]),
    async (req, res) => {
        try {
            const { userId } = req.params;
            const page = req.query.page || 1;
            const limit = req.query.limit || 10;
            const offset = (page - 1) * limit;

            const [rows, totalRow] = await Promise.all([
                dbAll(
                    "SELECT id, score, details, timestamp, imagePreview, recommendations FROM scans WHERE userId = ? ORDER BY timestamp DESC LIMIT ? OFFSET ?",
                    [userId, limit, offset]
                ),
                dbGet("SELECT COUNT(*) as total FROM scans WHERE userId = ?", [userId]),
            ]);

            const history = rows.map((r) => ({
                ...r,
                details: JSON.parse(r.details || "{}"),
                recommendations: JSON.parse(r.recommendations || "[]"),
            }));

            res.json({
                history,
                pagination: {
                    page,
                    limit,
                    total: totalRow.total,
                    pages: Math.ceil(totalRow.total / limit),
                },
            });
        } catch (e) {
            console.error(e);
            res.status(500).json({ error: "Internal server error" });
        }
    }
);

app.delete(
    "/api/scan/:scanId",
    validate([param("scanId").isInt().toInt()]),
    async (req, res) => {
        try {
            const { scanId } = req.params;
            const result = await dbRun("DELETE FROM scans WHERE id = ?", [scanId]);
            if (result.changes === 0) {
                return res.status(404).json({ success: false, message: "Scan not found" });
            }
            res.json({ success: true });
        } catch (e) {
            console.error(e);
            res.status(500).json({ error: "Internal server error" });
        }
    }
);

app.post(
    "/api/delete-history",
    validate([body("userId").isString().notEmpty()]),
    async (req, res) => {
        try {
            const { userId } = req.body;
            await dbRun("DELETE FROM scans WHERE userId = ?", [userId]);
            res.json({ success: true });
        } catch (e) {
            console.error(e);
            res.status(500).json({ error: "Internal server error" });
        }
    }
);

app.post(
    "/api/redeem",
    validate([
        body("userId").isString().notEmpty(),
        body("code").isString().trim().isLength({ min: 3 }),
    ]),
    async (req, res) => {
        try {
            const { userId, code } = req.body;
            const upperCode = code.trim().toUpperCase();

            const promo = await dbGet(
                `SELECT * FROM promo_codes 
                 WHERE code = ? AND expiresAt > ? AND usedCount < maxUses`,
                [upperCode, Date.now()]
            );

            if (!promo) {
                return res.json({ success: false, message: "Invalid or expired promo code" });
            }

            await dbRun("BEGIN IMMEDIATE");
            await dbRun("UPDATE promo_codes SET usedCount = usedCount + 1 WHERE code = ?", [upperCode]);
            const duration = promo.durationDays * 24 * 60 * 60 * 1000;
            const user = await dbGet("SELECT paidUntil FROM users WHERE id = ?", [userId]);
            const currentPaid = user?.paidUntil || 0;
            const newPaidUntil = Math.max(currentPaid, Date.now()) + duration;
            await dbRun("UPDATE users SET paidUntil = ? WHERE id = ?", [newPaidUntil, userId]);
            await dbRun("COMMIT");

            res.json({
                success: true,
                message: `PRO activated for ${promo.durationDays} days!`,
                paidUntil: newPaidUntil,
            });
        } catch (e) {
            await dbRun("ROLLBACK");
            console.error(e);
            res.status(500).json({ error: "Internal server error" });
        }
    }
);

app.post(
    "/api/payment",
    validate([
        body("userId").isString().notEmpty(),
        body("amount").isFloat({ min: 0.01 }),
    ]),
    async (req, res) => {
        try {
            const { userId, amount } = req.body;
            const transactionId = crypto.randomBytes(8).toString("hex");
            await dbRun(
                "INSERT INTO payments (userId, amount, date, transactionId) VALUES (?, ?, ?, ?)",
                [userId, amount, Date.now(), transactionId]
            );
            const exp = Date.now() + 30 * 24 * 60 * 60 * 1000;
            await dbRun("UPDATE users SET paidUntil = ? WHERE id = ?", [exp, userId]);
            res.json({ success: true, message: "Payment successful, PRO activated for 30 days!" });
        } catch (e) {
            console.error(e);
            res.status(500).json({ error: "Internal server error" });
        }
    }
);

app.get(
    "/api/export-history/:userId",
    validate([param("userId").isString().notEmpty()]),
    async (req, res) => {
        try {
            const { userId } = req.params;
            const rows = await dbAll("SELECT * FROM scans WHERE userId = ? ORDER BY timestamp DESC", [userId]);
            const history = rows.map((r) => ({
                ...r,
                details: JSON.parse(r.details || "{}"),
                recommendations: JSON.parse(r.recommendations || "[]"),
            }));
            res.setHeader("Content-Type", "application/json");
            res.setHeader("Content-Disposition", `attachment; filename="history_${userId}.json"`);
            res.json({ history });
        } catch (e) {
            console.error(e);
            res.status(500).json({ error: "Internal server error" });
        }
    }
);

app.get("/api/admin/stats", adminAuth, async (req, res) => {
    try {
        const [users, scans, proUsers, revenue] = await Promise.all([
            dbGet("SELECT COUNT(*) as count FROM users"),
            dbGet("SELECT COUNT(*) as count FROM scans"),
            dbGet("SELECT COUNT(*) as count FROM users WHERE paidUntil > ?", [Date.now()]),
            dbGet("SELECT SUM(amount) as total FROM payments"),
        ]);
        res.json({
            totalUsers: users.count,
            totalScans: scans.count,
            proUsers: proUsers.count,
            revenue: revenue.total || 0,
        });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: "Internal server error" });
    }
});

app.post("/api/generate-user", async (req, res) => {
    const newId = crypto.randomUUID();
    await dbRun("INSERT OR IGNORE INTO users (id, paidUntil, freeAttempts) VALUES (?,0,3)", [newId]);
    res.json({ userId: newId });
});

app.get("/api/latest-guide/:userId", async (req, res) => {
    try {
        const { userId } = req.params;
        const scan = await dbGet(
            "SELECT recommendations FROM scans WHERE userId = ? ORDER BY timestamp DESC LIMIT 1",
            [userId]
        );
        if (!scan) {
            return res.json({ recommendations: [] });
        }
        res.json({ recommendations: JSON.parse(scan.recommendations || "[]") });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.use((req, res) => {
    res.status(404).json({ error: "Endpoint not found" });
});

app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: "Something went wrong" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`✅ Server running on port ${PORT}`);
});