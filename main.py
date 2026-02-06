from fastapi import FastAPI, UploadFile, File, Form
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import psycopg2
from psycopg2.extras import RealDictCursor
import shutil
import os
import uuid
import psutil
import boto3

app = FastAPI()

app.mount("/static", StaticFiles(directory="static"), name="static")

# CONFIGURATION
DB_HOST = "10.0.11.186"
DB_NAME = "my_cloud_db"
DB_USER = "myuser"
DB_PASS = "mypassword"
S3_BUCKET = "imager0540"  # <--- KEEP YOUR BUCKET NAME HERE
S3_REGION = "eu-north-1"
CLOUDFRONT_URL = "https://ddgmom360hb06.cloudfront.net"  # <--- KEEP YOUR DOMAIN HERE


def get_db_connection():
    try:
        return psycopg2.connect(host=DB_HOST, database=DB_NAME, user=DB_USER, password=DB_PASS)
    except Exception as e:
        print("DB Error:", e)
        return None


def upload_to_s3(file_obj, filename):
    s3 = boto3.client('s3', region_name=S3_REGION)
    try:
        s3.upload_fileobj(file_obj, S3_BUCKET, filename, ExtraArgs={
                          'ACL': 'public-read', 'ContentType': 'image/jpeg'})
        return f"{CLOUDFRONT_URL}/{filename}"
    except Exception as e:
        print("S3 Upload Error:", e)
        return None


@app.get("/")
def read_index():
    return FileResponse("/var/www/html/index.html")


@app.get("/tweets")
def get_tweets():
    conn = get_db_connection()
    if not conn:
        return []
    cursor = conn.cursor(cursor_factory=RealDictCursor)
    cursor.execute("SELECT * FROM tweets ORDER BY created_at DESC")
    tweets = cursor.fetchall()
    conn.close()
    return tweets


@app.post("/tweet")
def post_tweet(content: str = Form(...), username: str = Form("Anonymous"), image: UploadFile = File(None)):
    image_url = None
    if image and image.filename:
        filename = f"{uuid.uuid4()}_{image.filename}"
        image_url = upload_to_s3(image.file, filename)

    conn = get_db_connection()
    if conn:
        cursor = conn.cursor()
        # UPDATED SQL QUERY TO INCLUDE USERNAME
        cursor.execute(
            "INSERT INTO tweets (content, username, image_filename) VALUES (%s, %s, %s)",
            (content, username, image_url)
        )
        conn.commit()
        conn.close()
        return {"message": "Posted!"}
    return {"error": "DB Fail"}


@app.get("/stats")
def get_stats():
    # 1. CPU & RAM
    cpu = psutil.cpu_percent(interval=None)
    mem = psutil.virtual_memory()
    disk = psutil.disk_usage('/')

    # 2. Network Traffic (Total Bytes Since Boot)
    net = psutil.net_io_counters()

    # 3. Connections
    conns = len([c for c in psutil.net_connections() if c.laddr.port == 80])

    return {
        "cpu": cpu,
        "ram_used": mem.used // (1024 * 1024),
        "ram_total": mem.total // (1024 * 1024),
        "ram_percent": mem.percent,
        "disk_percent": disk.percent,
        "connections": conns,
        "bytes_sent": net.bytes_sent,   # <--- NEW
        "bytes_recv": net.bytes_recv    # <--- NEW
    }
