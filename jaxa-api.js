// import
import * as je from "https://data.earth.jaxa.jp/api/jabascript/v2.0.0/jaxa.earth.esm.js";
import * as THREE from "https://unpkg.com/three@0.160.1/build/three.module.js";

// JAXA Earth API データ
const JAXA_API_BASE = "https://s3.ap-northeast-1.wasabisys.com/je-pds/cog/v1/";
const COLLECTIONS = {
    lccs: "Copernicus.C3S_PROBA-V_LCCS_global_yearly",
    lst: "JAXA.G-Portal_GCOM-C.SGLI_standard.L3-LST.daytime.v3_global_monthly",
    sst: "JAXA.G-Portal_GCOM-C.SGLI_standard.L3-SST.daytime.v3_global_monthly"
};

// 設定
const CONFIG = {
    canvasSize: 640,
    textureSize: { width: 2048, height: 1024 },
    sphereRadius: 1,
    sphereSegments: 64,
    cameraDistance: 2.5,
    temperatureOffset: 273.15
};

// Three.js シーン要素
let scene, renderer, camera, light, earth;
let canvas, context, texture;
let dataCache = {};

window.onload = async () => {
    initScene();
    await loadAllData();
    createEarth();
    setupEventListeners();
    update();
};

function initScene() {
    scene = new THREE.Scene();
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(CONFIG.canvasSize, CONFIG.canvasSize);
    document.getElementById("renderArea").appendChild(renderer.domElement);

    camera = new THREE.PerspectiveCamera(60, 1, 1, 10);
    light = new THREE.DirectionalLight("#FFFFFF", 2);
    const ambientLight = new THREE.AmbientLight("#CCCCCC");
    scene.add(light, ambientLight);
}

async function loadAllData() {
    const [lccsData, lstData, sstData] = await Promise.all([
        loadData("LCCS", COLLECTIONS.lccs, 0, 1),
        loadData("LST", COLLECTIONS.lst, -30 + CONFIG.temperatureOffset, 50 + CONFIG.temperatureOffset),
        loadData("SST", COLLECTIONS.sst, 0, 30)
    ]);

    dataCache = { lccsData, lstData, sstData };

    const message = `${lstData.date} 観測データ`;
    document.getElementById("message").innerText = message;
}

function createEarth() {
    canvas = document.createElement("canvas");
    context = canvas.getContext("2d");
    [canvas.width, canvas.height] = [CONFIG.textureSize.width, CONFIG.textureSize.height];

    updateTexture();

    const geometry = new THREE.SphereGeometry(CONFIG.sphereRadius, CONFIG.sphereSegments, CONFIG.sphereSegments);
    const material = new THREE.MeshPhongMaterial({ map: texture });
    earth = new THREE.Mesh(geometry, material);
    scene.add(earth);
}

function setupEventListeners() {
    // クリックで温度取得
    renderer.domElement.addEventListener("click", handleClick);

    // テクスチャ切替
    document.getElementById("lst").addEventListener("change", updateTexture);
    document.getElementById("sst").addEventListener("change", updateTexture);
}

function handleClick(event) {
    const intersect = getIntersectObject(event);
    if (intersect.length === 0) return;

    const [x, y] = getPosition(intersect[0].point);
    const coord = dataCache.lccsData.isp.getCoordinateByPixelXY(x, y);
    const lng = coord.x.toFixed(2);
    const lat = coord.y.toFixed(2);

    const lsTemp = dataCache.lstData.isp.getValueByPixelXY(x, y) - CONFIG.temperatureOffset;
    const ssTemp = dataCache.sstData.isp.getValueByPixelXY(x, y);

    let temp;
    if (!isNaN(lsTemp) && isNaN(ssTemp)) {
        temp = `地表面温度：${lsTemp.toFixed(2)}℃`;
    } else if (!isNaN(ssTemp)) {
        temp = `海水面温度：${ssTemp.toFixed(2)}℃`;
    } else {
        temp = "** 欠損 **";
    }

    document.getElementById("data").innerText = `緯度：${lat}° 経度：${lng}° ${temp}`;
}

async function loadData(dataName, collectionId, min, max) {
    document.getElementById("message").innerText = `読み込み中...${dataName}`;

    const dataObject = await je.getDataObject({
        collectionUrl: `${JAXA_API_BASE}${collectionId}/collection.json`,
        width: CONFIG.textureSize.width,
        height: CONFIG.textureSize.height,
        onloading: (per) => {
            document.getElementById("progress").value = per;
        }
    });

    const colorMap = new je.image.ColorMap({
        min,
        max,
        colors: je.Colors.JET
    });

    const canvas = je.image.createCanvas(dataObject, colorMap);
    const isp = new je.data.Inspector(dataObject);

    return {
        canvas,
        isp,
        date: dataObject.formattedDate
    };
}

function updateTexture() {
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(dataCache.lccsData.canvas, 0, 0);

    if (document.getElementById("lst").checked) {
        context.drawImage(dataCache.lstData.canvas, 0, 0);
    }
    if (document.getElementById("sst").checked) {
        context.drawImage(dataCache.sstData.canvas, 0, 0);
    }

    texture = new THREE.CanvasTexture(canvas);
}

function getIntersectObject(event) {
    const mouse = new THREE.Vector2();
    mouse.x = (event.offsetX / CONFIG.canvasSize) * 2 - 1;
    mouse.y = -((event.offsetY / CONFIG.canvasSize) * 2 - 1);

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, camera);

    return raycaster.intersectObject(earth);
}

function getPosition(point) {
    const { width, height } = CONFIG.textureSize;
    const a = Math.atan2(point.z, point.x);
    const b = Math.atan2(point.y, Math.hypot(point.x, point.z));

    const x = width / 2 - (width * a) / (Math.PI * 2);
    const y = height / 2 - (height * b) / Math.PI;

    return [x, y];
}

function update() {
    const h = parseFloat(document.getElementById("hAngle").value);
    const v = -parseFloat(document.getElementById("vAngle").value);

    const hAngle = h * Math.PI / 180;
    const vAngle = v * Math.PI / 180;

    // カメラ位置
    camera.position.y = CONFIG.cameraDistance * Math.sin(vAngle);
    let r = CONFIG.cameraDistance * Math.cos(vAngle);
    camera.position.x = r * Math.cos(hAngle);
    camera.position.z = r * Math.sin(hAngle);
    camera.lookAt(new THREE.Vector3(0, 0, 0));

    // ライト位置
    const lightHAngle = (h - 45) * Math.PI / 180;
    const lightVAngle = (v + 30) * Math.PI / 180;
    light.position.y = CONFIG.cameraDistance * Math.sin(lightVAngle);
    r = CONFIG.cameraDistance * Math.cos(lightVAngle);
    light.position.x = r * Math.cos(lightHAngle);
    light.position.z = r * Math.sin(lightHAngle);

    // 描画更新
    earth.material.map.needsUpdate = true;
    renderer.render(scene, camera);

    window.requestAnimationFrame(update);
}


