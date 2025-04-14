import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { gsap } from "gsap";
import { MeshLine, MeshLineMaterial, MeshLineRaycast } from 'three.meshline';
import { ExptParser } from "dials_javascript_parser/ExptParser.js";
import { marchingCubes } from 'marching-cubes-fast';


export class RSViewer {
  constructor(exptParser,colors = null) {

    this.expt = exptParser;
    this.meshData = null;
    this.meshShape = null;
    this.rLPMin = null;
    this.rLPMax = null;
    this.rLPStep = null;
    this.beamMeshes = [];
    this.sampleMesh = null;
    this.serverWS = null;
    this.minIntensityValue = 0.0;

    this.colors = null;
    if (colors != null) {
      this.colors = colors;
    }
    else {
      this.colors = RSViewer.defaultColors();
    }

    // Html elements
    this.sidebar = window.document.getElementById("sidebar");
    this.foregroundCheckbox = document.getElementById("foreground");
    this.backgroundCheckbox = document.getElementById("background");

    // Meshes
    this.currentMesh = null;
    this.boxSize = 100;
    this.boxGeometry = new THREE.BoxGeometry(
      this.boxSize, this.boxSize, this.boxSize);
    this.axesMeshes = [];
    this.axesPadding = 5;

    // Bookkeeping
    this.preventMouseClick = false;
    this.cursorActive = true;
    this.loading = false;
    this.foreground = this.colors["foreground"];
    this.background = this.colors["background"];

  }

  static defaultColors() {
    return {
      "background": 0x020817,
      "sample": 0xfdf6e3,
      "beam": 0xFFFFFF,
      "highlight": 0xFFFFFF,
      "foreground" : 0x96f97b,
    };
  }

  static sizes() {
    return {
      "beamLength": 800.,
      "sample": 1,
      "meshScaleFactor" : 1000.,
    };
  }

  static cameraPositions() {
    return {
      "default": new THREE.Vector3(0, 0, -1000),
      "defaultWithExperiment": new THREE.Vector3(-1000, 0, 0),
      "centre": new THREE.Vector3(0, 0, 0)
    };
  }

  toggleSidebar() {
    this.sidebar.style.display = this.sidebar.style.display === 'block' ? 'none' : 'block';
  }

  showSidebar() {
    this.sidebar.style.display = 'block';
  }

  enableMouseClick() {
    this.preventMouseClick = false;
  }

  setCameraToDefaultPosition() {
    this.setCameraSmooth(RSViewer.cameraPositions()["default"]);
  }

  setCameraToDefaultPositionWithExperiment() {
    this.setCameraSmooth(RSViewer.cameraPositions()["defaultWithExperiment"]);
  }

  setCameraSmooth(position) {
    this.rotateToPos(position);
    window.controls.update();
  }

  rotateToPos(pos) {
    gsap.to(window.camera.position, {
      duration: 1,
      x: -pos.x,
      y: -pos.y,
      z: -pos.z,
      onUpdate: function() {
        window.camera.lookAt(pos);
        window.viewer.requestRender();
      }
    });
  }

  clearExperiment() {

    for (var i = 0; i < this.beamMeshes.length; i++) {
      window.scene.remove(this.beamMeshes[i]);
      this.beamMeshes[i].geometry.dispose();
      this.beamMeshes[i].material.dispose();
    }
    this.beamMeshes = [];
    if (this.sampleMesh) {
      window.scene.remove(this.sampleMesh);
      this.sampleMesh.geometry.dispose();
      this.sampleMesh.material.dispose();
      this.sampleMesh = null;
    }

    this.expt.clearExperiment();
    this.clearMesh();
    this.requestRender();
  }

  hasExperiment() {
    return (this.expt.hasExptJSON());
  }


  addExperimentFromJSONString = async (
    jsonString) => {

    this.clearExperiment();
    await this.expt.parseExperimentJSON(jsonString);
    console.assert(this.hasExperiment());
    this.addBeam();
    this.addSample();
    this.setCameraToDefaultPositionWithExperiment();
    this.requestRender();
  }

  addSample() {
    const sphereGeometry = new THREE.SphereGeometry(
      RSViewer.sizes()["sample"]
    );
    const sphereMaterial = new THREE.MeshBasicMaterial({
      color: this.colors["sample"],
      transparent: true,
      depthWrite: false
    });
    const sphere = new THREE.Mesh(sphereGeometry, sphereMaterial);
    sphere.name = "sample";
    this.sampleMesh = sphere;
    window.scene.add(sphere);
    this.requestRender();
  }

  addBeam() {
    var beamLength = RSViewer.sizes()["beamLength"];
    var bd = this.expt.getBeamDirection(0); // Assume all experiments share the same beam

    // Incident beam to sample
    var incidentVertices = []
    incidentVertices.push(
      new THREE.Vector3(bd.x * -beamLength, bd.y * -beamLength, bd.z * -beamLength)
    );
    incidentVertices.push(
      new THREE.Vector3(bd.x * -beamLength * .5, bd.y * -beamLength * .5, bd.z * -beamLength * .5)
    );
    incidentVertices.push(new THREE.Vector3(0, 0, 0));
    const incidentLine = new THREE.BufferGeometry().setFromPoints(incidentVertices);
    const incidentMaterial = new THREE.LineBasicMaterial({
      color: this.colors["beam"],
      fog: true,
      depthWrite: false
    });
    const incidentMesh = new THREE.Line(incidentLine, incidentMaterial);
    this.beamMeshes.push(incidentMesh);
    window.scene.add(incidentMesh);

    // Outgoing beam from sample
    var outgoingVertices = []
    outgoingVertices.push(new THREE.Vector3(0, 0, 0));
    outgoingVertices.push(
      new THREE.Vector3(bd.x * beamLength * .5, bd.y * beamLength * .5, bd.z * beamLength * .5)
    );
    outgoingVertices.push(
      new THREE.Vector3(bd.x * beamLength, bd.y * beamLength, bd.z * beamLength)
    );
    const outgoingLine = new THREE.BufferGeometry().setFromPoints(outgoingVertices);
    const outgoingMaterial = new THREE.LineBasicMaterial({
      color: this.colors["beam"],
      transparent: true,
      opacity: .25,
      fog: true,
      depthWrite: false
    });
    const outgoingMesh = new THREE.Line(outgoingLine, outgoingMaterial);
    this.beamMeshes.push(outgoingMesh);
    window.scene.add(outgoingMesh);
    this.requestRender();
  }


  createSignedDistanceFunction(meshData, meshShape, isovalue) {
    return function (x, y, z) {
        let xi = Math.floor(x);
        let yi = Math.floor(y);
        let zi = Math.floor(z);
        if (xi < 0 || yi < 0 || zi < 0 || xi >= meshShape[0] || yi >= meshShape[1] || zi >= meshShape[2]) {
            return -1; 
        }
        return meshData[zi][yi][xi] - isovalue; 
    };

  }

  updateMaxResolution(){
    this.clearMesh();
    const resolution = document.getElementById("maxResolutionSlider").value;
		const data = JSON.stringify(
				{
					"channel" : "server",
					"command" : "update_rs_mapper_mesh",
					"max_resolution" : resolution
				}
			);
		this.serverWS.send(data);

  }

  updateMesh(){
    if (this.meshData === null || this.meshShape === null){
      return;
    }
    if (this.rLPMin === null || this.rLPMax === null || this.rLPStep === null){
      return;
    }
    const meshData = this.meshData;
    const meshShape = this.meshShape;
    const rLPMin = this.rLPMin;
    const rLPMax = this.rLPMax;
    const rLPStep = this.rLPStep;
    this.clearMesh();
    this.addContourMeshFromData(meshData, meshShape, rLPMin, rLPMax, rLPStep);

  }

  addContourMeshFromData(data, meshShape, rLPMin, rLPMax, rLPStep) {
    this.meshData = data;
    this.meshShape = meshShape;
    this.rLPMin = rLPMin;
    this.rLPMax = rLPMax;
    this.rLPStep = rLPStep;

    const isovalue = document.getElementById("meshThresholdSlider").value;
    this.loading=true;
      data = ExptParser.decompressImageData(data, meshShape);
      const sdf = this.createSignedDistanceFunction(data, meshShape, isovalue);

      const resolution = 64;
      const scanBounds = [[0,0,0], [meshShape[0], meshShape[1], meshShape[2]]];

      const result = marchingCubes(resolution, sdf, scanBounds);
      const positions = result.positions;
      const meshScaleFactor = RSViewer.sizes()["meshScaleFactor"];

      for (let i = 0; i < positions.length; i++) {
        const x = positions[i][0];
        const y = positions[i][1];
        const z = positions[i][2];

        // Reassign in z, y, x order
        positions[i][0] = ((z - meshShape[2] / 2) * rLPStep) * meshScaleFactor; 
        positions[i][1] = ((y - meshShape[1] / 2) * rLPStep) * meshScaleFactor; 
        positions[i][2] = ((x - meshShape[0] / 2) * rLPStep) * meshScaleFactor; 
      }

      const vertices = new Float32Array(positions.flat());
      const geometry = new THREE.BufferGeometry();
      const indices = new Uint32Array(result.cells.flat());

      geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
      geometry.setIndex(new THREE.BufferAttribute(indices, 1));
      geometry.computeVertexNormals();
      geometry.computeBoundingBox();

      const material = new THREE.MeshBasicMaterial({
      color: 0xFFFFFF,
      wireframe: true,
      });


      const contourMesh = new THREE.Mesh(geometry, material);
      window.scene.add(contourMesh);
      this.currentMesh = contourMesh;
      this.requestRender();
      this.loading=false;
  }


  disableMouseClick() {

    this.preventMouseClick = true;
  }

  enableMouseClick() {
    this.preventMouseClick = false;
  }

  clearAxes() {
    for (let i = 0; i < this.axesMeshes.length; i++) {
      window.scene.remove(this.axesMeshes[i]);
      this.axesMeshes[i].geometry.dispose();
      this.axesMeshes[i].material.dispose();
    }
    this.axesMeshes = [];

  }

  addAxes(origin, lengths) {
    function addAxisLabel(text, pos, color, scaleFactor) {
      var canvas = document.createElement('canvas');
      var context = canvas.getContext('2d');

      var baseFontSize = 32;
      var fontSize = baseFontSize * scaleFactor;

      context.font = "Bold " + fontSize + "px Tahoma";
      var textWidth = context.measureText(text).width;

      canvas.width = textWidth + 20;
      canvas.height = fontSize + 20;

      context = canvas.getContext('2d');

      context.font = "Bold " + fontSize + "px Tahoma";
      context.fillStyle = color;
      context.textAlign = "center";
      context.textBaseline = "middle";

      context.fillText(text, canvas.width / 2, canvas.height / 2);

      var texture = new THREE.CanvasTexture(canvas);

      var material = new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        alphaTest: 0.5,
        depthWrite: false,
        depthTest: false,
        sizeAttenuation: true
      });

      var sprite = new THREE.Sprite(material);

      sprite.scale.set(canvas.width / 10 * scaleFactor, canvas.height / 10 * scaleFactor, 1);
      sprite.position.copy(pos);

      if (!window.viewer.axesMeshes) {
        window.viewer.axesMeshes = [];
      }

      window.viewer.axesMeshes.push(sprite);
      window.scene.add(sprite);
      window.viewer.requestRender();
    }

    function addAxis(viewer, vertices, color) {
      const line = new MeshLine();
      line.setPoints(vertices);
      const Material = new MeshLineMaterial({
        lineWidth: 5,
        color: color,
        transparent: true,
        opacity: 0.5,
        depthWrite: false
      });
      const Mesh = new THREE.Mesh(line, Material);
      viewer.axesMeshes.push(Mesh);
      window.scene.add(Mesh);
    }

    this.axesMeshes = [];

    const xEnd = origin.clone().add(new THREE.Vector3(0, 0, 1).multiplyScalar(lengths.z));
    const yEnd = origin.clone().add(new THREE.Vector3(0, 1, 0).multiplyScalar(lengths.y));
    const zEnd = origin.clone().add(new THREE.Vector3(1, 0, 0).multiplyScalar(lengths.x));

    const xVertices = [origin, xEnd];
    const yVertices = [origin, yEnd];
    const zVertices = [origin, zEnd];

    addAxis(this, xVertices, this.colors["highlight"]);
    addAxisLabel("Z", zEnd.clone().add(new THREE.Vector3(10, 0, 0)), "white", 3);
    addAxis(this, yVertices, this.colors["highlight"]);
    addAxisLabel("Y", yEnd.clone().add(new THREE.Vector3(0, 10, 0)), "white", 3);
    addAxis(this, zVertices, this.colors["highlight"]);
    addAxisLabel("X", xEnd.clone().add(new THREE.Vector3(0, 0, 10)), "white", 3);
    this.requestRender();

  }



  clearMesh() {
    if (this.currentMesh !== null){
      window.scene.remove(this.currentMesh);
      this.currentMesh.geometry.dispose();
      this.currentMesh.material.dispose();
      if (this.currentMesh.isInstancedMesh) {
          this.currentMesh.count = 0;
          this.currentMesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
          this.currentMesh.instanceMatrix.needsUpdate = true;
      }
      this.currentMesh = null;
    }

    this.meshData = null;
    this.meshShape = null;
    this.rLPMin = null;
    this.rLPMax = null;
    this.rLPStep = null;
    this.clearAxes();
    this.requestRender();
  }


  requestRender() {
    if (typeof window !== "undefined" && !this.renderRequested) {
      this.renderRequested = true;
      window.requestAnimationFrame(this.animate.bind(this));
    }
  }

  animate() {
    if (!this.renderRequested) {
      return;
    }
    window.controls.update();
    window.renderer.render(window.scene, window.camera);
    this.renderRequested = false;
    window.viewer.enableMouseClick();
  }
}

export function setupScene() {

  /**
  * Sets the renderer, camera, controls
  */


  if (typeof window.viewer === "undefined") { return; }

  // Renderer
  window.renderer = new THREE.WebGLRenderer();
  window.renderer.setClearColor(window.viewer.colors["background"]);
  window.renderer.setSize(window.innerWidth, window.innerHeight);
  document.body.appendChild(window.renderer.domElement);

  window.scene = new THREE.Scene()
  window.camera = new THREE.PerspectiveCamera(
    45,
    window.innerWidth / window.innerHeight,
    100,
    100000
  );
  window.renderer.render(window.scene, window.camera);
  window.rayCaster = new THREE.Raycaster(); // used for all raycasting

  // Controls
  window.controls = new OrbitControls(window.camera, window.renderer.domElement);
  window.controls.maxDistance = 50000;
  window.controls.enablePan = false;
  window.controls.update();
  window.controls.addEventListener("change", function() { window.viewer.requestRender(); });

  // Events
  window.mousePosition = new THREE.Vector2();
  window.addEventListener("mousemove", function(e) {
    window.mousePosition.x = (e.clientX / window.innerWidth) * 2 - 1;
    window.mousePosition.y = - (e.clientY / window.innerHeight) * 2 + 1;
    window.viewer.requestRender();
  });

  window.addEventListener("resize", function() {
    window.camera.aspect = window.innerWidth / window.innerHeight;
    window.camera.updateProjectionMatrix();
    window.renderer.setSize(window.innerWidth, window.innerHeight);
    window.viewer.requestRender();
  });

  window.addEventListener('mousedown', function(event) {
    if (event.button == 2) {
      window.viewer.setCameraToDefaultPositionWithExperiment();
    }
  });

  window.addEventListener('mouseout', function(event) {
    this.window.viewer.cursorActive = false;
  });

  window.addEventListener('mouseover', function(event) {
    this.window.viewer.cursorActive = true;
  });

  window.addEventListener('keydown', function(event) {
    if (event.key === "s") {
      window.viewer.toggleSidebar();
    }
  });


  window.viewer.setCameraToDefaultPosition();
  window.viewer.requestRender();
}
