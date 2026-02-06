# ☁️ CloudNet Node: Distributed Social Platform

![Python](https://img.shields.io/badge/Python-3.10+-3776AB?style=flat&logo=python&logoColor=white)
![AWS](https://img.shields.io/badge/AWS-Cloud-232F3E?style=flat&logo=amazon-aws&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-009688?style=flat&logo=fastapi&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-336791?style=flat&logo=postgresql&logoColor=white)

**CloudNet Node** is a distributed, cloud-native web application designed to demonstrate robust networking principles. Unlike monolithic applications, this system decouples Compute, Database, and Object Storage into separate network entities, deployed within a secure Virtual Private Cloud (VPC) on AWS.

---

## 🏗️ Architecture & Topology

This project implements a **2-Tier Distributed Architecture** hosted in the `eu-north-1` (Stockholm) region.

```mermaid
graph TD
    User((User)) -->|HTTP/80| IGW[Internet Gateway]
    User -->|HTTPS/443| CDN[CloudFront CDN]
    CDN -->|Fetch| S3[S3 Bucket<br>Images]
    
    subgraph VPC [AWS VPC 10.0.0.0/16]
        IGW -->|Route| WebServer
        
        subgraph PublicSubnet [Public Subnet 10.0.1.0/24]
            WebServer[EC2 Web Node<br>Nginx + FastAPI]
            DBServer[EC2 DB Node<br>PostgreSQL]
        end
    end
    
    WebServer -->|TCP/5432| DBServer
    WebServer -->|Boto3 SDK| S3
