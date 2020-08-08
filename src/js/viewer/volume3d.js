
/*jslint browser: true, node: true */
/*global papayaRoundFast */

"use strict";

/*** Imports ***/
var papaya = papaya || {};
papaya.viewer = papaya.viewer || {};


/*** Shaders ***/

var shaderVert = [
    "#version 300 es",
    "precision highp float;",
    "precision highp int;",

    "in vec3 aVertexPosition;",
    "in vec3 aVertexTexCoord;",
    "in vec2 aTextureCoord;",
    "in vec4 aVertexColor; // used when drawing vertices other than the textured slice",

    "uniform mat4 uPMatrix; // projection matrix",
    "uniform mat4 uMVMatrix; // model-view matrix, will be required for shading",
    "uniform mat3 uNMatrix; // will be required for shading",
    "uniform mat4 uTexMatrix; // used to transform texture coordinates of textured slice",

    "// will be used for annotations",
    "uniform bool uColors;",
    "uniform bool uColorSolid;",
    "uniform vec4 uSolidColor;",
    "uniform bool uOrientationText;",
    "uniform bool uRuler;",

    "// output to fragment shader",
    "out lowp vec4 vColor;",
    "out vec2 vTextureCoord;",
    "out vec3 vVertexTexCoord;",
    "out vec3 vTransformedTexCoord;",

    "void main(void) {",
    "    vec4 transformedTexCoord = uTexMatrix * vec4(aVertexTexCoord, 1.0);",
    "    vTransformedTexCoord = transformedTexCoord.xyz;",
    "    vVertexTexCoord = aVertexTexCoord;",
    "    gl_Position = uPMatrix * vec4(aVertexPosition, 1.0);",
    "}"
].join("\n");

var shaderFrag = [
    "#version 300 es",
    "precision highp float;",
    "precision highp int;",
    "precision highp sampler3D;",

    "uniform vec3 uVolumeCoord; // current slice plane location",
    "uniform bool uVolumeSlice;",
    "uniform int uSlicePlane; // slice plane linked to axial / coronal / sagittal MPR ",
    "uniform int uBytesPerPixel; // 1 or 2 (8 or 16 bits)",

    "// will be used for annotations",
    "uniform bool uColors;",
    "uniform bool uColorSolid;",
    "uniform vec4 uSolidColor;",
    "uniform bool uOrientationText;",
    "uniform bool uRuler;",
    "uniform sampler2D uSampler;",

    "uniform sampler3D uVolumeSampler; // volume texture",
    "uniform sampler2D uLutSampler; // lookup table texture (256x1 2D texture)",

    "in lowp vec4 vColor;",
    "in vec2 vTextureCoord;",
    "in vec3 vVertexTexCoord;",
    "in vec3 vTransformedTexCoord;",

    "out vec4 fragColor;",

    "void main(void) {",
    "   vec4 fragmentColor = vec4(1.0, 1.0, 1.0, 1.0);",
    "   fragColor = vec4(0.0,0.0,0.0,1.0);",

    "   if (uColors) {",
    "      fragmentColor = vColor;",
    "   } else if (uColorSolid) {",
    "      fragmentColor = vColor;",
    "   }",

    "   // discard fragment if outside texture limits",
    "   if(vTransformedTexCoord.x < 0.0 || vTransformedTexCoord.y < 0.0 ||vTransformedTexCoord.z < 0.0 || ",
    "       vTransformedTexCoord.x > 1.0 || vTransformedTexCoord.y > 1.0 || vTransformedTexCoord.z > 1.0) discard;",

    "   if (uVolumeSlice) {",
    "      // sample 3D texture along the current slice",
    "      fragColor = texture(uVolumeSampler, vTransformedTexCoord);",
    "      float lutIndex = uBytesPerPixel > 1 ? fragColor.g + fragColor.b/16.0 + fragColor.a/256.0 : fragColor.r;",
    "      fragColor = texture(uLutSampler, vec2(lutIndex, 0.0));",
    "      if(fragColor.a < 0.1) discard;",
    "      else{",
    "          // if slice plane is enabled, then check if fragment is on visible side, or is clipped away",
    "          if(uSlicePlane == 1){   //AXIAL",
    "              if(dot(vTransformedTexCoord - vec3(0.5,0.5,0.5), vec3(0.0,0.0,1.0)) < uVolumeCoord.z - 0.5) discard;",
    "          }else if(uSlicePlane == 2){ //CORONAL",
    "              if(dot(vTransformedTexCoord - vec3(0.5,0.5,0.5), vec3(0.0,1.0,0.0)) < uVolumeCoord.y - 0.5) discard;",
    "          }else if(uSlicePlane == 3){ //SAGITTAL",
    "              if(dot(vTransformedTexCoord - vec3(0.5,0.5,0.5), vec3(1.0,0.0,0.0)) < uVolumeCoord.x - 0.5) discard;",
    "          }",
    "      }",
    "   } else if (uRuler) {",
    "      fragColor = vec4(1.0, 0.078, 0.576, 1.0);",
    "   } else if (uOrientationText) {",
    "       vec4 textureColor = texture(uSampler, vec2(vTextureCoord.s, vTextureCoord.t));",
    "       if (textureColor.a > 0.0) {",
    "          fragColor = vec4(textureColor.rgb, textureColor.a);",
    "       } else {",
    "          fragColor = vec4(textureColor.rgb, 0);",
    "       }",
    "   }",
    "}"
].join("\n");


/*** Constructor ***/

papaya.viewer.Volume3D = papaya.viewer.Volume3D || function (baseVolume, colorTable, viewer, params) {
    this.shaderProgram = null;
    this.mvMatrix = mat4.create();
    this.texMatrix = mat4.create();
    this.pMatrix = mat4.create();
    this.pMatrix1 = mat4.create();
    this.centerMat = mat4.create();
    this.centerMatInv = mat4.create();
    this.tempMat = mat4.create();
    this.tempMat2 = mat4.create();
    this.pickingBuffer = null;
    this.initialized = false;
    this.screenOffsetX = 0;
    this.screenOffsetY = 0;
    this.screenDim = 0;
    this.screenTransform = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    this.volume = baseVolume;
    this.colorTable = colorTable;
    this.viewer = viewer;
    this.currentCoord = viewer.currentCoord;
    this.zoom = 0;
    this.sliceDirection = papaya.viewer.ScreenSlice.DIRECTION_SURFACE;
    this.dynamicStartX = -1;
    this.dynamicStartY = -1;
    this.texScaleX = 1.0;
    this.texScaleY = 1.0;
    this.texScaleZ = 1.0;
    this.texSizeX = 1;
    this.texSizeY = 1;
    this.texSizeZ = 1;
    this.volumeSliceVerts = new Float32Array(12);
    this.volumeSliceTexCoords = null;
    this.coronalTexCoords = null;
    this.sagittalTexCoords = null;
    this.coronalVerts = new Float32Array(12);
    this.sagittalVerts = new Float32Array(12);
    this.volumeSliceVertsEdges = new Float32Array(24);
    this.coronalVertsEdges = new Float32Array(24);
    this.sagittalVertsEdges = new Float32Array(24);
    this.orientationVerts = new Float32Array(24);
    this.crosshairLineVertsX = new Float32Array(6);
    this.crosshairLineVertsY = new Float32Array(6);
    this.crosshairLineVertsZ = new Float32Array(6);
    this.mouseRotDragX = this.clearTransform([]);
    this.mouseRotDragY = this.clearTransform([]);
    this.mouseRotDrag = this.clearTransform([]);
    this.mouseTransDrag = this.clearTransform([]);
    this.mouseRotCurrent = this.clearTransform([]);
    this.mouseTransCurrent = this.clearTransform([]);
    this.mouseRotTemp = this.clearTransform([]);
    this.mouseTransTemp = this.clearTransform([]);
    this.volumeSliceBuffer = null;
    this.volumeSliceTexCoordBuffer = null;
    this.coronalBuffer = null;
    this.coronalTexCoordBuffer = null;
    this.sagittalBuffer = null;
    this.sagittalTexCoordBuffer = null;
    this.activePlaneAxialEdgesBuffer = null;
    this.activePlaneCoronalEdgesBuffer = null;
    this.activePlaneSagittalEdgesBuffer = null;
    this.volumeTexture = null;
    this.volumeData = null;
    this.lutTexture = null;
    this.LUT = null;
    this.orientationBuffer = null;
    this.crosshairLineXBuffer = null;
    this.crosshairLineYBuffer = null;
    this.crosshairLineZBuffer = null;
    this.crosshairLineZBuffer = null;
    this.xSize = this.volume.header.voxelDimensions.xSize;
    this.xDim = this.volume.header.imageDimensions.xDim;
    this.xHalf = (this.xDim * this.xSize) / 2.0;
    this.ySize = this.volume.header.voxelDimensions.ySize;
    this.yDim = this.volume.header.imageDimensions.yDim;
    this.yHalf = (this.yDim * this.ySize) / 2.0;
    this.zSize = this.volume.header.voxelDimensions.zSize;
    this.zDim = this.volume.header.imageDimensions.zDim;
    this.zHalf = (this.zDim * this.zSize) / 2.0;
    this.showVolume = (viewer.container.preferences.showVolume === "Yes");
    this.backgroundColor = papaya.viewer.Volume3D.DEFAULT_BACKGROUND;
    this.pickLocX = 0;
    this.pickLocY = 0;
    this.needsPickColor = false;
    this.pickedColor = null;
    this.needsPick = false;
    this.pickedCoordinate = null;
    this.scaleFactor = 1;
    this.orientationTexture = null;
    this.orientationTextureCoords = null;
    this.orientationTextureCoordBuffer = null;
    this.orientationCanvas = null;
    this.orientationContext = null;
    this.rulerPoints = null;
    this.grabbedRulerPoint = -1;

    this.processParams(params);
};



/*** Static Pseudo-constants ***/

papaya.viewer.Volume3D.DEFAULT_ORIENTATION = [ -0.015552218963737041, 0.09408106275544359, -0.9954430697501158, 0,
                                                    -0.9696501263313991, 0.24152923619118966, 0.03797658948646743, 0,
                                                    0.24400145970103732, 0.965822108594413, 0.0874693978960848, 0,
                                                    0, 0, 0, 1];
papaya.viewer.Volume3D.MOUSE_SENSITIVITY = 0.3;
papaya.viewer.Volume3D.DEFAULT_BACKGROUND = [0.5, 0.5, 0.5];
papaya.viewer.Volume3D.TEXT_SIZE = 50;
papaya.viewer.Volume3D.ORIENTATION_SIZE = 10;
papaya.viewer.Volume3D.RULER_COLOR = [1, 0.078, 0.576];
papaya.viewer.Volume3D.RULER_NUM_LINES = 25;
papaya.viewer.Volume3D.RULER_RADIUS = 1;


/*** Static Variables ***/



/*** Static Methods ***/

papaya.viewer.Volume3D.makeShader = function (gl, src, type) {
    var shader = gl.createShader(type);

    gl.shaderSource(shader, src);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.log(gl.getShaderInfoLog(shader));
        return null;
    }

    return shader;
};


// compile and link shaders
// query and store attribute and uniform locations
papaya.viewer.Volume3D.initShaders = function (gl) {
    var fragmentShader = papaya.viewer.Volume3D.makeShader(gl, shaderVert, gl.VERTEX_SHADER);
    var vertexShader = papaya.viewer.Volume3D.makeShader(gl, shaderFrag, gl.FRAGMENT_SHADER);
    var shaderProgram = gl.createProgram();
    gl.attachShader(shaderProgram, vertexShader);
    gl.attachShader(shaderProgram, fragmentShader);
    gl.linkProgram(shaderProgram);

    if (!gl.getProgramParameter(shaderProgram, gl.LINK_STATUS)) {
        console.log("Could not initialise shaders");
    }

    gl.useProgram(shaderProgram);

    shaderProgram.vertexPositionAttribute = gl.getAttribLocation(shaderProgram, "aVertexPosition");
    gl.enableVertexAttribArray(shaderProgram.vertexPositionAttribute);
    shaderProgram.vertexTexCoordAttribute = gl.getAttribLocation(shaderProgram, "aVertexTexCoord");
    shaderProgram.vertexColorAttribute = gl.getAttribLocation(shaderProgram, "aVertexColor");
    shaderProgram.textureCoordAttribute = gl.getAttribLocation(shaderProgram, "aTextureCoord");

    shaderProgram.pMatrixUniform = gl.getUniformLocation(shaderProgram, "uPMatrix");
    shaderProgram.mvMatrixUniform = gl.getUniformLocation(shaderProgram, "uMVMatrix");
    shaderProgram.texMatrixUniform = gl.getUniformLocation(shaderProgram, "uTexMatrix");
    shaderProgram.bytesPerPixel = gl.getUniformLocation(shaderProgram, "uBytesPerPixel");
    shaderProgram.volumeSlice = gl.getUniformLocation(shaderProgram, "uVolumeSlice");
    shaderProgram.volumeCoord = gl.getUniformLocation(shaderProgram, "uVolumeCoord");
    shaderProgram.slicePlane = gl.getUniformLocation(shaderProgram, "uSlicePlane");
    shaderProgram.hasColors = gl.getUniformLocation(shaderProgram, "uColors");
    shaderProgram.hasSolidColor = gl.getUniformLocation(shaderProgram, "uColorSolid");
    shaderProgram.solidColor = gl.getUniformLocation(shaderProgram, "uSolidColor");
    shaderProgram.orientationText = gl.getUniformLocation(shaderProgram, "uOrientationText");
    shaderProgram.samplerUniform = gl.getUniformLocation(shaderProgram, "uSampler");
    shaderProgram.volumeSamplerUniform = gl.getUniformLocation(shaderProgram, "uVolumeSampler");
    shaderProgram.lutSamplerUniform = gl.getUniformLocation(shaderProgram, "uLutSampler");
    shaderProgram.ruler = gl.getUniformLocation(shaderProgram, "uRuler");

    return shaderProgram;
};



/*** Prototype Methods ***/

papaya.viewer.Volume3D.prototype.initialize = function () {
    var ctr;

    this.initialized = true;

    this.canvas = document.createElement("canvas");
    this.canvas.width = this.screenDim;
    this.canvas.height = this.screenDim;
    this.context = this.canvas.getContext('webgl2', { antialias: false });
    this.context.viewportWidth = this.canvas.width;
    this.context.viewportHeight = this.canvas.height;

    this.zoom = this.volume.header.imageDimensions.yDim * this.volume.header.voxelDimensions.ySize * 1.5;
    this.initView();

    this.shaderProgram = papaya.viewer.Volume3D.initShaders(this.context);

    this.calculateScaleFactor();
    this.initVolumeBuffers(this.context);
    this.initRulerBuffers(this.context);

    //mat4.multiply(this.centerMat, papaya.viewer.Volume3D.DEFAULT_ORIENTATION, this.tempMat);
    var mat = mat4.create();
    mat4.identity(mat);
    mat4.multiply(this.centerMat, mat, this.tempMat);
    mat4.multiply(this.tempMat, this.centerMatInv, this.mouseRotCurrent);

    this.updateBackgroundColor();
};



papaya.viewer.Volume3D.prototype.calculateScaleFactor = function () {
    var xRange = (this.xSize * this.xDim),
        yRange = (this.ySize * this.yDim),
        zRange = (this.zSize * this.zDim),
        longestRange = xRange;

    if (yRange > longestRange) {
        longestRange = yRange;
    }

    if (zRange > longestRange) {
        longestRange = zRange;
    }

    this.scaleFactor = (longestRange / 64.0);
};



papaya.viewer.Volume3D.prototype.resize = function (screenDim) {
    if (!this.initialized) {
        this.initialize();
    }

    this.screenDim = screenDim;
    this.canvas.width = this.screenDim;
    this.canvas.height = this.screenDim;
    this.context.viewportWidth = this.canvas.width;
    this.context.viewportHeight = this.canvas.height;
};


// called every frame to pass current matrices to shader
papaya.viewer.Volume3D.prototype.applyMatrixUniforms = function(gl) {
    gl.uniformMatrix4fv(this.shaderProgram.pMatrixUniform, false, this.pMatrix);
    gl.uniformMatrix4fv(this.shaderProgram.mvMatrixUniform, false, this.mvMatrix);
    gl.uniformMatrix4fv(this.shaderProgram.texMatrixUniform, false, this.texMatrix);
    var normalMatrix = mat3.create();
    mat4.toInverseMat3(this.mvMatrix, normalMatrix);
    mat3.transpose(normalMatrix);
    gl.uniformMatrix3fv(this.shaderProgram.nMatrixUniform, false, normalMatrix);
};


// top level draw event handler
papaya.viewer.Volume3D.prototype.draw = function () {
    if (!this.initialized) {
        this.initialize();
    }

    this.drawScene(this.context);
};


// create GL buffers
papaya.viewer.Volume3D.prototype.initVolumeBuffers = function (gl) {
    this.updateVolumeView();

    // create volume buffers
    this.volumeSliceBuffer = gl.createBuffer();
    this.volumeSliceBuffer.itemSize = 3;
    this.volumeSliceBuffer.numItems = 4;
    this.volumeSliceTexCoordBuffer = gl.createBuffer();
    this.volumeSliceTexCoordBuffer.itemSize = 3;
    this.volumeSliceTexCoordBuffer.numItems = 4;

    // create buffers for standard views (axial/coronal/sagittal)
    // will be used to draw the visual representation of the cut planes

    this.coronalBuffer = gl.createBuffer();
    this.coronalBuffer.itemSize = 3;
    this.coronalBuffer.numItems = 4;
    this.coronalTexCoordBuffer = gl.createBuffer();
    this.coronalTexCoordBuffer.itemSize = 3;
    this.coronalTexCoordBuffer.numItems = 4;

    this.sagittalBuffer = gl.createBuffer();
    this.sagittalBuffer.itemSize = 3;
    this.sagittalBuffer.numItems = 4;
    this.sagittalTexCoordBuffer = gl.createBuffer();
    this.sagittalTexCoordBuffer.itemSize = 3;
    this.sagittalTexCoordBuffer.numItems = 4;

    this.activePlaneAxialEdgesBuffer = gl.createBuffer();
    this.activePlaneAxialEdgesBuffer.itemSize = 3;
    this.activePlaneAxialEdgesBuffer.numItems = 8;

    this.activePlaneCoronalEdgesBuffer = gl.createBuffer();
    this.activePlaneCoronalEdgesBuffer.itemSize = 3;
    this.activePlaneCoronalEdgesBuffer.numItems = 8;

    this.activePlaneSagittalEdgesBuffer = gl.createBuffer();
    this.activePlaneSagittalEdgesBuffer.itemSize = 3;
    this.activePlaneSagittalEdgesBuffer.numItems = 8;

    this.crosshairLineXBuffer = gl.createBuffer();
    this.crosshairLineXBuffer.itemSize = 3;
    this.crosshairLineXBuffer.numItems = 2;

    this.crosshairLineYBuffer = gl.createBuffer();
    this.crosshairLineYBuffer.itemSize = 3;
    this.crosshairLineYBuffer.numItems = 2;

    this.crosshairLineZBuffer = gl.createBuffer();
    this.crosshairLineZBuffer.itemSize = 3;
    this.crosshairLineZBuffer.numItems = 2;
};

// initialize view
papaya.viewer.Volume3D.prototype.initView = function () {
    this.center = new vec3.create();
    this.centerWorld = new papaya.core.Coordinate();
    this.viewer.getWorldCoordinateAtIndex(parseInt(this.xDim / 2, 10), parseInt(this.yDim / 2, 10), parseInt(this.zDim / 2, 10), this.centerWorld);
    this.center[0] = this.centerWorld.x;
    this.center[1] = this.centerWorld.y;
    this.center[2] = this.centerWorld.z;

    mat4.identity(this.centerMat);
    mat4.translate(this.centerMat, [this.center[0], this.center[1], this.center[2]]);

    mat4.identity(this.centerMatInv);
    mat4.translate(this.centerMatInv, [-this.center[0], -this.center[1], -this.center[2]]);

    this.updateView();
};

// set up orthographic projection
papaya.viewer.Volume3D.prototype.updateView = function () {
    this.pMatrix = mat4.ortho(-this.yHalf, this.yHalf, -this.yHalf, this.yHalf, -this.yHalf, this.yHalf);
};


// draws the volume rendered view
papaya.viewer.Volume3D.prototype.drawScene = function (gl) {
    var ctr, xSlice, ySlice, zSlice;

    // initialize
    //gl.clearColor(this.backgroundColor[0], this.backgroundColor[1], this.backgroundColor[2], 1.0);
    gl.clearColor(0.0, 0.0, 0.0, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    gl.viewport(0, 0, gl.viewportWidth, gl.viewportHeight);
    mat4.identity(this.mvMatrix);
    mat4.multiply(this.mouseRotDrag, this.mouseRotCurrent, this.mouseRotTemp);
    mat4.multiply(this.mouseTransDrag, this.mouseTransCurrent, this.mouseTransTemp);
    mat4.multiply(this.mouseTransTemp, this.mouseRotTemp, this.tempMat);
    mat4.set(this.tempMat, this.mvMatrix);
    mat4.identity(this.texMatrix);
    mat4.translate(this.texMatrix, [this.texScaleX / 2.0, this.texScaleY / 2.0, this.texScaleZ / 2.0]);
    mat4.multiply(this.mouseRotDrag, this.mouseRotCurrent, this.mouseRotTemp);
    this.mouseRotTemp[12] = this.mouseRotTemp[13] = this.mouseRotTemp[14] = 0.0;
    mat4.inverse(this.mouseRotTemp);
    mat4.multiply(this.texMatrix, this.mouseRotTemp, this.tempMat);
    mat4.translate(this.tempMat, [-this.texScaleX / 2.0, -this.texScaleY / 2.0, -this.texScaleZ / 2.0]);
    mat4.set(this.tempMat, this.texMatrix);
    this.applyMatrixUniforms(gl);

    // used when shading is enabled
    gl.uniform3f(this.shaderProgram.ambientColorUniform, 0.2, 0.2, 0.2);
    gl.uniform3f(this.shaderProgram.pointLightingLocationUniform, 0, 0, 300 * this.scaleFactor);
    gl.uniform3f(this.shaderProgram.pointLightingColorUniform, 0.8, 0.8, 0.8);

    gl.uniform1i(this.shaderProgram.orientationText, 0);
    gl.uniform1i(this.shaderProgram.volumeSlice, 0);
    gl.uniform1i(this.shaderProgram.crosshairs, 0);
    gl.uniform1i(this.shaderProgram.hasColors, 0);
    gl.uniform1i(this.shaderProgram.colorPicking, 0);
    gl.uniform1i(this.shaderProgram.trianglePicking, 0);

    if (this.needsPick) {
        gl.uniform1i(this.shaderProgram.trianglePicking, 1);

        if ((this.pickingBuffer === null) || (this.pickingBuffer.length !== (gl.viewportWidth * gl.viewportHeight * 4))) {
            this.pickingBuffer = new Uint8Array(gl.viewportWidth * gl.viewportHeight * 4);
        }
    } else if (this.needsPickColor) {
        gl.uniform1i(this.shaderProgram.colorPicking, 1);

        if ((this.pickingBuffer === null) || (this.pickingBuffer.length !== (gl.viewportWidth * gl.viewportHeight * 4))) {
            this.pickingBuffer = new Uint8Array(gl.viewportWidth * gl.viewportHeight * 4);
        }
    }

    // get current position of crosshair to apply standard view slicing
    var volCoord = vec3.create([this.texScaleX * this.currentCoord.x / this.xDim, this.texScaleY * this.currentCoord.y / this.yDim, this.texScaleZ * this.currentCoord.z / this.zDim]);
    gl.uniform3fv(this.shaderProgram.volumeCoord, volCoord);

    // get slice plane currently enabled
    var slicePlane = 0;``
    if (this.viewer.container.preferences.showAxialPlane === "Yes") slicePlane = 1;
    else if (this.viewer.container.preferences.showCoronalPlane === "Yes") slicePlane = 2;
    else if (this.viewer.container.preferences.showSagittalPlane === "Yes") slicePlane = 3;
    gl.uniform1i(this.shaderProgram.slicePlane, slicePlane);

    gl.uniform1i(this.shaderProgram.hasSolidColor, 0);
    gl.uniform1i(this.shaderProgram.hasColors, 0);

    if (this.showVolume) {
        // draw volume

        if (this.needsupdateVolumeView) {
            this.needsupdateVolumeView = false;
            this.bindVolume(gl);
        }

        this.renderVolume(gl);
    }

    // restore GL state
    gl.enable(gl.DEPTH_TEST);
};



// create 3D texture and load it using the 8/16-bit volume data
papaya.viewer.Volume3D.prototype.bindVolume = function (gl) {

    // create and load 3D volume texture

    if (this.volumeTexture === null) {
        var value;
        var index = 0;
        if (this.volume.header.imageType.numBytes == 1) {
            var shift = this.volume.header.imageType.numBytes > 1 ? 4 : 0;
            this.volumeData = new Uint8Array(this.texSizeX * this.texSizeY * this.texSizeZ);
            for (var k = 0; k < this.volume.header.imageDimensions.slices; k += 1) {
                for (var j = 0; j < this.volume.header.imageDimensions.rows; j += 1) {
                    index = this.texSizeX * this.texSizeY * k + this.texSizeX * j;
                    for (var i = 0; i < this.volume.header.imageDimensions.cols; i += 1) {
                        value = this.volume.getVoxelAtIndex(i, j, k, 0, true);
                        value -= this.volume.header.imageRange.globalDataScaleIntercept;
                        this.volumeData[index + i] = (Math.max(0, value) >> shift) & 0xff;
                    }
                }
            }
        }
        else {
            this.volumeData = new Uint16Array(this.texSizeX * this.texSizeY * this.texSizeZ);
            for (var k = 0; k < this.volume.header.imageDimensions.slices; k += 1) {
                for (var j = 0; j < this.volume.header.imageDimensions.rows; j += 1) {
                    index = this.texSizeX * this.texSizeY * k + this.texSizeX * j;
                    for (var i = 0; i < this.volume.header.imageDimensions.cols; i += 1) {
                        value = this.volume.getVoxelAtIndex(i, j, k, 0, true);
                        value -= this.volume.header.imageRange.globalDataScaleIntercept;
                        this.volumeData[index + i] = Math.max(0, value);
                    }
                }
            }
        }

        this.volumeTexture = gl.createTexture();
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_3D, this.volumeTexture);
        gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        if (this.volume.header.imageType.numBytes > 1)
            gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA4, this.texSizeX, this.texSizeY, this.texSizeZ, 0, gl.RGBA, gl.UNSIGNED_SHORT_4_4_4_4, this.volumeData);
        else
            gl.texImage3D(gl.TEXTURE_3D, 0, gl.R8, this.texSizeX, this.texSizeY, this.texSizeZ, 0, gl.RED, gl.UNSIGNED_BYTE, this.volumeData);


        // populate LUT using current color table in Papaya viewer
        this.LUT = new Uint8Array(256 * 4);
        for (var intensity = 0; intensity < 256; ++intensity) {
            this.LUT[intensity * 4 + 0] = this.colorTable.lookupRed(intensity, intensity);
            this.LUT[intensity * 4 + 1] = this.colorTable.lookupGreen(intensity, intensity);
            this.LUT[intensity * 4 + 2] = this.colorTable.lookupBlue(intensity, intensity);
            this.LUT[intensity * 4 + 3] = 0.5 * intensity;
        }

        // create and load lookup (color table) texture
        // 1D array of RGBA values is loaded as a 256x1 2D texture as 1D textures may not be supported
        this.lutTexture = gl.createTexture();
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.lutTexture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, this.LUT);
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, this.volumeSliceBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.volumeSliceVerts, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.volumeSliceTexCoordBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.volumeSliceTexCoords, gl.DYNAMIC_DRAW);

    // :TODO: draw slice planes
    //gl.bindBuffer(gl.ARRAY_BUFFER, this.coronalBuffer);
    //gl.bufferData(gl.ARRAY_BUFFER, this.coronalVerts, gl.DYNAMIC_DRAW);
    //gl.bindBuffer(gl.ARRAY_BUFFER, this.coronalTexCoordBuffer);
    //gl.bufferData(gl.ARRAY_BUFFER, this.coronalTexCoords, gl.DYNAMIC_DRAW);

    //gl.bindBuffer(gl.ARRAY_BUFFER, this.sagittalBuffer);
    //gl.bufferData(gl.ARRAY_BUFFER, this.sagittalVerts, gl.DYNAMIC_DRAW);
    //gl.bindBuffer(gl.ARRAY_BUFFER, this.sagittalTexCoordBuffer);
    //gl.bufferData(gl.ARRAY_BUFFER, this.sagittalTexCoords, gl.DYNAMIC_DRAW);

    // we currently do not draw the edges, but could be useful when drawing the slice plane
    //gl.bindBuffer(gl.ARRAY_BUFFER, this.activePlaneAxialEdgesBuffer);
    //gl.bufferData(gl.ARRAY_BUFFER, this.volumeSliceVertsEdges, gl.DYNAMIC_DRAW);

    //gl.bindBuffer(gl.ARRAY_BUFFER, this.activePlaneCoronalEdgesBuffer);
    //gl.bufferData(gl.ARRAY_BUFFER, this.coronalVertsEdges, gl.DYNAMIC_DRAW);

    //gl.bindBuffer(gl.ARRAY_BUFFER, this.activePlaneSagittalEdgesBuffer);
    //gl.bufferData(gl.ARRAY_BUFFER, this.sagittalVertsEdges, gl.DYNAMIC_DRAW);
};



// draw the volume rendered view
// draw a stack of view-aligned slices that are 3D textured using the volume data
// blending is enabled, and fragments are composited using the "over" operator
papaya.viewer.Volume3D.prototype.renderVolume = function (gl) {

    // set up texture state
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_3D, this.volumeTexture);
    gl.uniform1i(this.shaderProgram.volumeSamplerUniform, 1);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.lutTexture);
    gl.uniform1i(this.shaderProgram.lutSamplerUniform, 0);

    gl.depthMask(true);
    gl.depthFunc(gl.ALWAYS);
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    gl.uniform1i(this.shaderProgram.volumeSlice, 1);
    gl.uniform1i(this.shaderProgram.bytesPerPixel, this.volume.header.imageType.numBytes);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.volumeSliceBuffer);
    gl.vertexAttribPointer(this.shaderProgram.vertexPositionAttribute, this.volumeSliceBuffer.itemSize, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.volumeSliceTexCoordBuffer);
    gl.enableVertexAttribArray(this.shaderProgram.vertexTexCoordAttribute);
    gl.vertexAttribPointer(this.shaderProgram.vertexTexCoordAttribute, this.volumeSliceTexCoordBuffer.itemSize, gl.FLOAT, false, 0, 0);

    // draw a stack of view-aligned slices that are 3D textured using the volume data
    var sliceCount = 2 * this.xDim;
    var tempMat = mat4.create();
    mat4.set(this.texMatrix, tempMat);
    mat4.translate(tempMat, [0, 0, -0.366]);
    var viewStep = vec3.create();
    vec3.scale([0, 0, 1], 1.732 / sliceCount, viewStep);
    for (var slice = 0; slice < sliceCount; ++slice) {
        // step through the stack
        mat4.translate(tempMat, viewStep);
        gl.uniformMatrix4fv(this.shaderProgram.texMatrixUniform, false, tempMat);
        // draw the textured quad
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    gl.disableVertexAttribArray(this.shaderProgram.vertexTexCoordAttribute);

    gl.uniform1i(this.shaderProgram.volumeSlice, 0);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
};


// called when color table is changed in Papaya viewer
papaya.viewer.Volume3D.prototype.changeColorTable = function (viewer, lutName) {
    this.colorTable = new papaya.viewer.ColorTable(lutName, true);
    this.updateLut(this.viewer.currentScreenVolume.screenMin, this.viewer.currentScreenVolume.screenMax, false);
};


// called when color table needs to be updated due to window-level/opacity change
papaya.viewer.Volume3D.prototype.updateLut = function (minFinal, maxFinal, isOpacity) {
    if (isOpacity) {
        var range = maxFinal - minFinal;
        for (var index = 0; index < 256; ++index) {
            if (index < minFinal || index > maxFinal) {
                this.LUT[index * 4 + 3] = 0;
            }
            else {
                this.LUT[index * 4 + 3] = 255 * (index - minFinal) / range;
            }
        }
    }
    else {
        this.colorTable.updateLUT(minFinal, maxFinal);
        for (var lutIndex = 0; lutIndex < 256; ++lutIndex) {
            var intensity = lutIndex;
            this.LUT[lutIndex * 4 + 0] = this.colorTable.lookupRed(intensity, intensity);
            this.LUT[lutIndex * 4 + 1] = this.colorTable.lookupGreen(intensity, intensity);
            this.LUT[lutIndex * 4 + 2] = this.colorTable.lookupBlue(intensity, intensity);
        }
    }

    // update the LUT texture
    var gl = this.context;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.lutTexture);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 256, 1, gl.RGBA, gl.UNSIGNED_BYTE, this.LUT);
};


papaya.viewer.Volume3D.prototype.updateVolume = function (coord, draggingSlice) {
    this.currentCoord = coord;
};



papaya.viewer.Volume3D.prototype.initOrientationBuffers = function (gl) {
    this.makeOrientedTextSquare();
    this.orientationBuffer = gl.createBuffer();
    this.orientationBuffer.itemSize = 3;
    this.orientationBuffer.numItems = 4;

    this.orientationTextureCoordBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.orientationTextureCoordBuffer);
    this.orientationTextureCoords = [
        0.0, 1.0,
        0.0, 0.0,
        1.0, 1.0,
        1.0, 0.0
    ];
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(this.orientationTextureCoords), gl.STATIC_DRAW);
    this.orientationTextureCoordBuffer.itemSize = 2;
    this.orientationTextureCoordBuffer.numItems = 4;
};

papaya.viewer.Volume3D.prototype.initRulerBuffers = function (gl) {
    this.rulerPointData = this.makeSphere(papaya.viewer.Volume3D.RULER_NUM_LINES,
        papaya.viewer.Volume3D.RULER_NUM_LINES, papaya.viewer.Volume3D.RULER_RADIUS * this.scaleFactor);

    this.sphereVertexPositionBuffer = gl.createBuffer();
    this.sphereVertexPositionBuffer.itemSize = 3;
    this.sphereVertexPositionBuffer.numItems = this.rulerPointData.vertices.length / 3;

    this.sphereNormalsPositionBuffer = gl.createBuffer();
    this.sphereNormalsPositionBuffer.itemSize = 3;
    this.sphereNormalsPositionBuffer.numItems = this.rulerPointData.normals.length / 3;

    this.sphereVertexIndexBuffer = gl.createBuffer();
    this.sphereVertexIndexBuffer.itemSize = 1;
    this.sphereVertexIndexBuffer.numItems = this.rulerPointData.indices.length;

    this.rulerLineBuffer = gl.createBuffer();
    this.rulerLineBuffer.itemSize = 3;
    this.rulerLineBuffer.numItems = 2;
};



papaya.viewer.Volume3D.prototype.drawRuler = function (gl) {
    var found = true;

    if (this.rulerPoints === null) {
        this.rulerPoints = new Float32Array(6);
        found = this.findInitialRulerPoints(gl);
        this.drawScene(gl);  // need to redraw since pick
    }

    if (found) {
        gl.uniform1i(this.shaderProgram.ruler, 1);

        // draw endpoints
        this.drawRulerPoint(gl, this.rulerPoints[0], this.rulerPoints[1], this.rulerPoints[2]);
        this.drawRulerPoint(gl, this.rulerPoints[3], this.rulerPoints[4], this.rulerPoints[5]);

        // draw line
        gl.bindBuffer(gl.ARRAY_BUFFER, this.rulerLineBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, this.rulerPoints, gl.DYNAMIC_DRAW);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.rulerLineBuffer);
        gl.vertexAttribPointer(this.shaderProgram.vertexPositionAttribute, this.rulerLineBuffer.itemSize, gl.FLOAT,
            false, 0, 0);
        gl.drawArrays(gl.LINES, 0, 2);
        gl.uniform1i(this.shaderProgram.ruler, 0);
    }
};



papaya.viewer.Volume3D.prototype.drawRulerPoint = function (gl, xLoc, yLoc, zLoc) {
    this.sphereVertexPositionBuffer.numItems = this.rulerPointData.vertices.length / 3;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.sphereVertexPositionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(this.rulerPointData.vertices), gl.STATIC_DRAW);

    this.sphereNormalsPositionBuffer.numItems = this.rulerPointData.normals.length / 3;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.sphereNormalsPositionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(this.rulerPointData.normals), gl.STATIC_DRAW);

    this.sphereVertexIndexBuffer.numItems = this.rulerPointData.indices.length;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.sphereVertexIndexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(this.rulerPointData.indices), gl.STATIC_DRAW);

    gl.uniform1i(this.shaderProgram.hasSolidColor, 1);
    gl.uniform4f(this.shaderProgram.solidColor, papaya.viewer.Volume3D.RULER_COLOR[0],
        papaya.viewer.Volume3D.RULER_COLOR[1], papaya.viewer.Volume3D.RULER_COLOR[2], 1.0);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.sphereVertexPositionBuffer);
    gl.vertexAttribPointer(this.shaderProgram.vertexPositionAttribute, this.sphereVertexPositionBuffer.itemSize,
        gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.sphereNormalsPositionBuffer);
    gl.vertexAttribPointer(this.shaderProgram.vertexNormalAttribute, this.sphereNormalsPositionBuffer.itemSize,
        gl.FLOAT, false, 0, 0);

    mat4.set(this.mvMatrix, this.tempMat);
    mat4.translate(this.mvMatrix, [xLoc, yLoc, zLoc]);
    this.applyMatrixUniforms(gl);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.sphereVertexIndexBuffer);
    gl.drawElements(gl.TRIANGLES, this.sphereVertexIndexBuffer.numItems, gl.UNSIGNED_SHORT, 0);
    mat4.set(this.tempMat, this.mvMatrix);
    this.applyMatrixUniforms(gl);
};



papaya.viewer.Volume3D.prototype.drawOrientedText = function (gl, str, fontSize, coord) {
    if (this.orientationCanvas === null) {
        this.initOrientationBuffers(this.context);
    }

    this.updateOrientedTextSquare(fontSize, str);

    if (this.orientationTexture === null) {
        this.orientationTexture = gl.createTexture();
    }

    this.bindOrientation(gl);
    gl.enableVertexAttribArray(this.shaderProgram.textureCoordAttribute);
    gl.uniform1i(this.shaderProgram.orientationText, 1);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    this.orientationContext.imageSmoothingEnabled = true;
    this.orientationContext.mozImageSmoothingEnabled = true;
    this.orientationContext.msImageSmoothingEnabled = true;
    this.orientationContext.textAlign = "center";
    this.orientationContext.textBaseline = "middle";
    this.orientationContext.font = fontSize + "px sans-serif";
    this.orientationContext.clearRect(0, 0, this.orientationCanvas.width, this.orientationCanvas.height);
    this.orientationContext.fillStyle = "#FFFFFF";
    this.orientationContext.fillText(str, this.orientationCanvas.width / 2, this.orientationCanvas.height / 2);

    mat4.set(this.mvMatrix, this.tempMat);
    mat4.multiplyVec3(this.mvMatrix, coord);
    mat4.identity(this.mvMatrix);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.orientationBuffer);
    gl.vertexAttribPointer(this.shaderProgram.vertexPositionAttribute, this.orientationBuffer.itemSize, gl.FLOAT, false, 0, 0);

    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
    gl.bindTexture(gl.TEXTURE_2D, this.orientationTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.orientationCanvas);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_NEAREST);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.orientationTextureCoordBuffer);
    gl.vertexAttribPointer(this.shaderProgram.textureCoordAttribute, this.orientationTextureCoordBuffer.itemSize, gl.FLOAT, false, 0, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.orientationTexture);
    gl.uniform1i(this.shaderProgram.samplerUniform, 0);

    mat4.translate(this.mvMatrix, coord);
    this.applyMatrixUniforms(gl);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    mat4.set(this.tempMat, this.mvMatrix);
    this.applyMatrixUniforms(gl);

    gl.disable(gl.BLEND);

    gl.uniform1i(this.shaderProgram.orientationText, 0);
    gl.disableVertexAttribArray(this.shaderProgram.textureCoordAttribute);
};



papaya.viewer.Volume3D.prototype.bindOrientation = function (gl) {
    gl.bindBuffer(gl.ARRAY_BUFFER, this.orientationBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.orientationVerts, gl.DYNAMIC_DRAW);
};


papaya.viewer.Volume3D.prototype.clearDTILinesImage = function () {
    // just here to satisfy Papaya interface
};


papaya.viewer.Volume3D.prototype.findProximalRulerHandle = function (xLoc, yLoc) {
    this.pick(xLoc, yLoc, true);
    this.grabbedRulerPoint = -1;

    if (this.pickedCoordinate && this.rulerPoints) {
        if (papaya.utilities.MathUtils.lineDistance3d(this.rulerPoints[0], this.rulerPoints[1],
                this.rulerPoints[2], this.pickedCoordinate.coordinate[0], this.pickedCoordinate.coordinate[1], this.pickedCoordinate.coordinate[2]) <
                (papaya.viewer.ScreenSlice.GRAB_RADIUS * this.scaleFactor)) {
            this.grabbedRulerPoint = 0;
        } else if (papaya.utilities.MathUtils.lineDistance3d(this.rulerPoints[3], this.rulerPoints[4],
                this.rulerPoints[5], this.pickedCoordinate.coordinate[0], this.pickedCoordinate.coordinate[1], this.pickedCoordinate.coordinate[2]) <
                (papaya.viewer.ScreenSlice.GRAB_RADIUS * this.scaleFactor)) {
            this.grabbedRulerPoint = 1;
        }
    }

    return (this.grabbedRulerPoint !== -1);
};


papaya.viewer.Volume3D.prototype.setStartDynamic = function (xLoc, yLoc) {
    this.dynamicStartX = xLoc;
    this.dynamicStartY = yLoc;
};



papaya.viewer.Volume3D.prototype.updateDynamic = function (xLoc, yLoc, factor) {
    var rotX = (yLoc - this.dynamicStartY) * papaya.viewer.Volume3D.MOUSE_SENSITIVITY * factor;
    var rotY = (xLoc - this.dynamicStartX) * papaya.viewer.Volume3D.MOUSE_SENSITIVITY * factor;

    var theta = (rotY * Math.PI) / 180.0;
    mat4.identity(this.mouseRotDragX);
    mat4.rotateY(this.mouseRotDragX, theta);

    theta = (rotX * Math.PI) / 180.0;
    mat4.identity(this.mouseRotDragY);
    mat4.rotateX(this.mouseRotDragY, theta);

    mat4.multiply(this.centerMat, this.mouseRotDragY, this.tempMat);
    mat4.multiply(this.tempMat, this.mouseRotDragX, this.tempMat2);
    mat4.multiply(this.tempMat2, this.centerMatInv, this.mouseRotDrag);
};



papaya.viewer.Volume3D.prototype.updateTranslateDynamic = function (xLoc, yLoc, factor) {
    var transX = (xLoc - this.dynamicStartX) * papaya.viewer.Volume3D.MOUSE_SENSITIVITY * factor;
    var transY = (yLoc - this.dynamicStartY) * papaya.viewer.Volume3D.MOUSE_SENSITIVITY * factor * -1;
    mat4.identity(this.mouseTransDrag);
    mat4.translate(this.mouseTransDrag, [transX, transY, 0]);
};



papaya.viewer.Volume3D.prototype.updateCurrent = function () {
    var temp = mat4.multiply(this.mouseRotDrag, this.mouseRotCurrent);
    mat4.set(temp, this.mouseRotCurrent);

    temp = mat4.multiply(this.mouseTransDrag, this.mouseTransCurrent);
    mat4.set(temp, this.mouseTransCurrent);

    mat4.identity(this.mouseTransDrag);
    mat4.identity(this.mouseRotDragX);
    mat4.identity(this.mouseRotDragY);
    mat4.identity(this.mouseRotDrag);
};



papaya.viewer.Volume3D.prototype.clearTransform = function (xform) {
    mat4.identity(xform);
    return xform;
};



papaya.viewer.Volume3D.prototype.makeOrientedTextSquare = function () {
    var half = papaya.viewer.Volume3D.ORIENTATION_SIZE * this.scaleFactor;

    this.orientationVerts[0] = -half;
    this.orientationVerts[1] = half;
    this.orientationVerts[2] = 0;

    this.orientationVerts[3] = -half;
    this.orientationVerts[4] = -half;
    this.orientationVerts[5] = 0;

    this.orientationVerts[6] = half;
    this.orientationVerts[7] = half;
    this.orientationVerts[8] = 0;

    this.orientationVerts[9] = half;
    this.orientationVerts[10] = -half;
    this.orientationVerts[11] = 0;

    this.orientationCanvas = document.createElement("canvas");
    this.orientationContext = this.orientationCanvas.getContext('2d');
    this.orientationContext.imageSmoothingEnabled = true;
    this.orientationContext.mozImageSmoothingEnabled = true;
    this.orientationContext.msImageSmoothingEnabled = true;
    this.orientationContext.fillStyle = "#FFFFFF";
    this.orientationContext.textAlign = "center";
    this.orientationContext.textBaseline = "middle";
};



papaya.viewer.Volume3D.prototype.updateOrientedTextSquare = function (fontSize, text) {
    var textWidth, textHeight, textSize;

    this.orientationContext.imageSmoothingEnabled = true;
    this.orientationContext.mozImageSmoothingEnabled = true;
    this.orientationContext.msImageSmoothingEnabled = true;
    this.orientationContext.fillStyle = "#FFFFFF";
    this.orientationContext.textAlign = "center";
    this.orientationContext.textBaseline = "middle";
    this.orientationContext.font = fontSize + "px sans-serif";
    textWidth = this.orientationContext.measureText(text).width;
    textHeight = fontSize;
    textSize = Math.max(textWidth, textHeight);

    this.orientationCanvas.width = papaya.utilities.MathUtils.getPowerOfTwo(textSize);
    this.orientationCanvas.height = papaya.utilities.MathUtils.getPowerOfTwo(textSize);
};


// update volume view based on current MPR crosshair position
// update cutaway view if slice plane is enabled
// update slice plane quads if visible (not implemented yet)
papaya.viewer.Volume3D.prototype.updateVolumeView = function () {
    var xSlice, ySlice, zSlice;

    if (!this.showVolume && !this.viewer.isShowingCrosshairs()) {
        return;
    }

    xSlice = this.currentCoord.x + ((this.xDim / 2) - this.volume.header.origin.x);
    ySlice = this.yDim - this.currentCoord.y - ((this.yDim / 2) - this.volume.header.origin.y);
    zSlice = this.zDim - this.currentCoord.z - ((this.zDim / 2) - this.volume.header.origin.z);

    // axial plane
    this.volumeSliceVerts[0] = -this.yHalf;
    this.volumeSliceVerts[1] = this.yHalf;
    this.volumeSliceVerts[2] = 0;

    this.volumeSliceVerts[3] = -this.yHalf;
    this.volumeSliceVerts[4] = -this.yHalf;
    this.volumeSliceVerts[5] = 0;

    this.volumeSliceVerts[6] = this.yHalf;
    this.volumeSliceVerts[7] = this.yHalf;
    this.volumeSliceVerts[8] = 0;

    this.volumeSliceVerts[9] = this.yHalf
    this.volumeSliceVerts[10] = -this.yHalf;
    this.volumeSliceVerts[11] = 0;

    // pad texture dimensions up to nearest power-of-two
    this.texSizeX = this.texSizeY = this.texSizeZ = 1;
    while (this.texSizeX < this.volume.header.imageDimensions.cols) this.texSizeX *= 2;
    while (this.texSizeY < this.volume.header.imageDimensions.rows) this.texSizeY *= 2;
    while (this.texSizeZ < this.volume.header.imageDimensions.slices) this.texSizeZ *= 2;

    // use offsets to centre the volume within the POT texture bounds
    this.texScaleX = this.volume.header.imageDimensions.cols / this.texSizeX;
    this.texScaleY = this.volume.header.imageDimensions.rows / this.texSizeY;
    this.texScaleZ = this.volume.header.imageDimensions.slices / this.texSizeZ;
    var texExtentScale = 1.0;
    var texOffset = (texExtentScale - 1.0) / 2.0;
    this.volumeSliceTexCoords = new Float32Array([
        -texOffset, this.texScaleY * texExtentScale, 0.5 * this.texScaleZ * texExtentScale,
        -texOffset, -texOffset, 0.5 * this.texScaleZ * texExtentScale,
        this.texScaleX * texExtentScale, this.texScaleY * texExtentScale, 0.5 * this.texScaleZ * texExtentScale,
        this.texScaleX * texExtentScale, -texOffset, 0.5 * this.texScaleZ * texExtentScale
    ]);

    this.coronalTexCoords = new Float32Array([
        -texOffset, 0.5 * this.texScaleY * texExtentScale, this.texScaleZ * texExtentScale,
        -texOffset, 0.5 * this.texScaleY * texExtentScale, -texOffset,
        this.texScaleX * texExtentScale, 0.5 * this.texScaleY * texExtentScale, this.texScaleZ * texExtentScale,
        this.texScaleX * texExtentScale, 0.5 * this.texScaleY * texExtentScale, -texOffset
    ]);
    this.sagittalTexCoords = new Float32Array([
        0.5 * this.texScaleX * texExtentScale, -texOffset, this.texScaleZ * texExtentScale,
        0.5 * this.texScaleX * texExtentScale, -texOffset, -texOffset,
        0.5 * this.texScaleX * texExtentScale, this.texScaleY * texExtentScale, this.texScaleZ * texExtentScale,
        0.5 * this.texScaleX * texExtentScale, this.texScaleY * texExtentScale, -texOffset
    ]);

    // axial plane edges
    this.volumeSliceVertsEdges[0] = -this.xHalf + this.centerWorld.x;
    this.volumeSliceVertsEdges[1] = this.yHalf + this.centerWorld.y;
    this.volumeSliceVertsEdges[2] = (zSlice * this.zSize) - this.zHalf;

    this.volumeSliceVertsEdges[3] = -this.xHalf + this.centerWorld.x;
    this.volumeSliceVertsEdges[4] = -this.yHalf + this.centerWorld.y;
    this.volumeSliceVertsEdges[5] = (zSlice * this.zSize) - this.zHalf;

    this.volumeSliceVertsEdges[6] = -this.xHalf + this.centerWorld.x;
    this.volumeSliceVertsEdges[7] = -this.yHalf + this.centerWorld.y;
    this.volumeSliceVertsEdges[8] = (zSlice * this.zSize) - this.zHalf;

    this.volumeSliceVertsEdges[9] = this.xHalf + this.centerWorld.x;
    this.volumeSliceVertsEdges[10] = -this.yHalf + this.centerWorld.y;
    this.volumeSliceVertsEdges[11] = (zSlice * this.zSize) - this.zHalf;

    this.volumeSliceVertsEdges[12] = this.xHalf + this.centerWorld.x;
    this.volumeSliceVertsEdges[13] = -this.yHalf + this.centerWorld.y;
    this.volumeSliceVertsEdges[14] = (zSlice * this.zSize) - this.zHalf;

    this.volumeSliceVertsEdges[15] = this.xHalf + this.centerWorld.x;
    this.volumeSliceVertsEdges[16] = this.yHalf + this.centerWorld.y;
    this.volumeSliceVertsEdges[17] = (zSlice * this.zSize) - this.zHalf;

    this.volumeSliceVertsEdges[18] = this.xHalf + this.centerWorld.x;
    this.volumeSliceVertsEdges[19] = this.yHalf + this.centerWorld.y;
    this.volumeSliceVertsEdges[20] = (zSlice * this.zSize) - this.zHalf;

    this.volumeSliceVertsEdges[21] = -this.xHalf + this.centerWorld.x;
    this.volumeSliceVertsEdges[22] = this.yHalf + this.centerWorld.y;
    this.volumeSliceVertsEdges[23] = (zSlice * this.zSize) - this.zHalf;

    // coronal plane

    var ypos = (this.currentCoord.y - this.yHalf);
    this.coronalVerts[0] = -this.xHalf + this.centerWorld.x;
    this.coronalVerts[1] = ypos;
    this.coronalVerts[2] = this.zHalf + this.centerWorld.z;

    this.coronalVerts[3] = -this.xHalf + this.centerWorld.x;
    this.coronalVerts[4] = ypos;
    this.coronalVerts[5] = -this.zHalf + this.centerWorld.z;

    this.coronalVerts[6] = this.xHalf + this.centerWorld.x;
    this.coronalVerts[7] = ypos;
    this.coronalVerts[8] = this.zHalf + this.centerWorld.z;

    this.coronalVerts[9] = this.xHalf + this.centerWorld.x;
    this.coronalVerts[10] = ypos;
    this.coronalVerts[11] = -this.zHalf + this.centerWorld.z;

    // coronal plane edges
    this.coronalVertsEdges[0] = -this.xHalf + this.centerWorld.x;
    this.coronalVertsEdges[1] = ((ySlice * this.ySize) - this.yHalf);
    this.coronalVertsEdges[2] = this.zHalf + this.centerWorld.z;

    this.coronalVertsEdges[3] = -this.xHalf + this.centerWorld.x;
    this.coronalVertsEdges[4] = ((ySlice * this.ySize) - this.yHalf);
    this.coronalVertsEdges[5] = -this.zHalf + this.centerWorld.z;

    this.coronalVertsEdges[6] = -this.xHalf + this.centerWorld.x;
    this.coronalVertsEdges[7] = ((ySlice * this.ySize) - this.yHalf);
    this.coronalVertsEdges[8] = -this.zHalf + this.centerWorld.z;

    this.coronalVertsEdges[9] = this.xHalf + this.centerWorld.x;
    this.coronalVertsEdges[10] = ((ySlice * this.ySize) - this.yHalf);
    this.coronalVertsEdges[11] = -this.zHalf + this.centerWorld.z;

    this.coronalVertsEdges[12] = this.xHalf + this.centerWorld.x;
    this.coronalVertsEdges[13] = ((ySlice * this.ySize) - this.yHalf);
    this.coronalVertsEdges[14] = -this.zHalf + this.centerWorld.z;

    this.coronalVertsEdges[15] = this.xHalf + this.centerWorld.x;
    this.coronalVertsEdges[16] = ((ySlice * this.ySize) - this.yHalf);
    this.coronalVertsEdges[17] = this.zHalf + this.centerWorld.z;

    this.coronalVertsEdges[18] = this.xHalf + this.centerWorld.x;
    this.coronalVertsEdges[19] = ((ySlice * this.ySize) - this.yHalf);
    this.coronalVertsEdges[20] = this.zHalf + this.centerWorld.z;

    this.coronalVertsEdges[21] = -this.xHalf + this.centerWorld.x;
    this.coronalVertsEdges[22] = ((ySlice * this.ySize) - this.yHalf);
    this.coronalVertsEdges[23] = this.zHalf + this.centerWorld.z;

    // sagittal plane
    this.sagittalVerts[0] = (xSlice * this.xSize) - this.xHalf;
    this.sagittalVerts[1] = -this.yHalf + this.centerWorld.y;
    this.sagittalVerts[2] = this.zHalf + this.centerWorld.z;

    this.sagittalVerts[3] = (xSlice * this.xSize) - this.xHalf;
    this.sagittalVerts[4] = -this.yHalf + this.centerWorld.y;
    this.sagittalVerts[5] = -this.zHalf + this.centerWorld.z;

    this.sagittalVerts[6] = (xSlice * this.xSize) - this.xHalf;
    this.sagittalVerts[7] = this.yHalf + this.centerWorld.y;
    this.sagittalVerts[8] = this.zHalf + this.centerWorld.z;

    this.sagittalVerts[9] = (xSlice * this.xSize) - this.xHalf;
    this.sagittalVerts[10] = this.yHalf + this.centerWorld.y;
    this.sagittalVerts[11] = -this.zHalf + this.centerWorld.z;

    // sagittal plane edges
    this.sagittalVertsEdges[0] = (xSlice * this.xSize) - this.xHalf;
    this.sagittalVertsEdges[1] = -this.yHalf + this.centerWorld.y;
    this.sagittalVertsEdges[2] = this.zHalf + this.centerWorld.z;

    this.sagittalVertsEdges[3] = (xSlice * this.xSize) - this.xHalf;
    this.sagittalVertsEdges[4] = -this.yHalf + this.centerWorld.y;
    this.sagittalVertsEdges[5] = -this.zHalf + this.centerWorld.z;

    this.sagittalVertsEdges[6] = (xSlice * this.xSize) - this.xHalf;
    this.sagittalVertsEdges[7] = -this.yHalf + this.centerWorld.y;
    this.sagittalVertsEdges[8] = -this.zHalf + this.centerWorld.z;

    this.sagittalVertsEdges[9] = (xSlice * this.xSize) - this.xHalf;
    this.sagittalVertsEdges[10] = this.yHalf + this.centerWorld.y;
    this.sagittalVertsEdges[11] = -this.zHalf + this.centerWorld.z;

    this.sagittalVertsEdges[12] = (xSlice * this.xSize) - this.xHalf;
    this.sagittalVertsEdges[13] = this.yHalf + this.centerWorld.y;
    this.sagittalVertsEdges[14] = -this.zHalf + this.centerWorld.z;

    this.sagittalVertsEdges[15] = (xSlice * this.xSize) - this.xHalf;
    this.sagittalVertsEdges[16] = this.yHalf + this.centerWorld.y;
    this.sagittalVertsEdges[17] = this.zHalf + this.centerWorld.z;

    this.sagittalVertsEdges[18] = (xSlice * this.xSize) - this.xHalf;
    this.sagittalVertsEdges[19] = this.yHalf + this.centerWorld.y;
    this.sagittalVertsEdges[20] = this.zHalf + this.centerWorld.z;

    this.sagittalVertsEdges[21] = (xSlice * this.xSize) - this.xHalf;
    this.sagittalVertsEdges[22] = -this.yHalf + this.centerWorld.y;
    this.sagittalVertsEdges[23] = this.zHalf + this.centerWorld.z;

    // crosshairs X
    this.crosshairLineVertsZ[0] = ((xSlice * this.xSize) - this.xHalf);
    this.crosshairLineVertsZ[1] = ((ySlice * this.ySize) - this.yHalf);
    this.crosshairLineVertsZ[2] = -this.zHalf + this.centerWorld.z;

    this.crosshairLineVertsZ[3] = ((xSlice * this.xSize) - this.xHalf);
    this.crosshairLineVertsZ[4] = ((ySlice * this.ySize) - this.yHalf);
    this.crosshairLineVertsZ[5] = this.zHalf + this.centerWorld.z;

    // crosshair Y
    this.crosshairLineVertsY[0] = ((xSlice * this.xSize) - this.xHalf);
    this.crosshairLineVertsY[1] = -this.yHalf + this.centerWorld.y;
    this.crosshairLineVertsY[2] = ((zSlice * this.zSize) - this.zHalf);

    this.crosshairLineVertsY[3] = ((xSlice * this.xSize) - this.xHalf);
    this.crosshairLineVertsY[4] = this.yHalf + this.centerWorld.y;
    this.crosshairLineVertsY[5] = ((zSlice * this.zSize) - this.zHalf);

    // crosshair X
    this.crosshairLineVertsX[0] = -this.xHalf + this.centerWorld.x;
    this.crosshairLineVertsX[1] = ((ySlice * this.ySize) - this.yHalf);
    this.crosshairLineVertsX[2] = ((zSlice * this.zSize) - this.zHalf);

    this.crosshairLineVertsX[3] = this.xHalf + this.centerWorld.x;
    this.crosshairLineVertsX[4] = ((ySlice * this.ySize) - this.yHalf);
    this.crosshairLineVertsX[5] = ((zSlice * this.zSize) - this.zHalf);

    this.needsupdateVolumeView = true;
};



papaya.viewer.Volume3D.prototype.pick = function (xLoc, yLoc, skipRedraw) {
    this.needsPick = true;
    this.pickLocX = xLoc;
    this.pickLocY = yLoc;
    this.draw(); // do picking

    if (skipRedraw) {
        return this.pickedCoordinate;
    }

    this.draw(); // redraw scene
    return this.pickedCoordinate;
};



papaya.viewer.Volume3D.prototype.pickRuler = function (xLoc, yLoc) {
    this.needsPick = true;
    this.pickLocX = xLoc;
    this.pickLocY = yLoc;
    this.draw(); // do picking

    if (this.pickedCoordinate) {
        this.rulerPoints[(this.grabbedRulerPoint * 3)] = this.pickedCoordinate.coordinate[0];
        this.rulerPoints[(this.grabbedRulerPoint * 3) + 1] = this.pickedCoordinate.coordinate[1];
        this.rulerPoints[(this.grabbedRulerPoint * 3) + 2] = this.pickedCoordinate.coordinate[2];

        this.draw(); // redraw scene
    }

    return this.pickedCoordinate;
};



papaya.viewer.Volume3D.prototype.pickColor = function (xLoc, yLoc) {
    this.needsPickColor = true;
    this.pickLocX = xLoc;
    this.pickLocY = yLoc;
    this.draw(); // do picking
    this.draw(); // redraw scene
    return this.pickedColor;
};


papaya.viewer.Volume3D.prototype.unpackFloatFromVec4i = function (val) {
    var bitSh = [1.0 / (64.0 * 64.0 * 64.0), 1.0 / (64.0 * 64.0), 1.0 / 64.0, 1.0];
    return ((val[0] * bitSh[0]) + (val[1] * bitSh[1]) + (val[2] * bitSh[2]) + (val[3] * bitSh[3]));
};



papaya.viewer.Volume3D.prototype.findPickedCoordinate = function (gl, xLoc, yLoc) {
    var winX = xLoc,
        winY = (gl.viewportHeight - 1 - yLoc),
        winZ, viewportArray, success, modelPointArrayResults = [];

    gl.readPixels(winX, winY, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, this.pickingBuffer);
    winZ = (this.unpackFloatFromVec4i(this.pickingBuffer) / 255.0);

    if (winZ >= 1) {
        return null;
    }

    viewportArray = [0, 0, gl.viewportWidth, gl.viewportHeight];

    success = GLU.unProject(
        winX, winY, winZ,
        this.mvMatrix, this.pMatrix,
        viewportArray, modelPointArrayResults);

    if (success) {
        return {coordinate: modelPointArrayResults, depth: winZ};
    }

    return null;
};



papaya.viewer.Volume3D.prototype.findInitialRulerPoints = function (gl) {
    var xDim = gl.viewportWidth,
        yDim = gl.viewportHeight,
        coord, points = [], finalPoints = [], xLoc, yLoc, ctr, index;

    for (ctr = 1; ctr < 5; ctr += 1) {
        xLoc = parseInt(xDim * .1 * ctr, 10);
        yLoc = parseInt(yDim * .1 * ctr, 10);
        coord = this.pick(xLoc, yLoc, true);
        if (coord) {
            points.push(coord);
        }

        xLoc = parseInt(xDim - (xDim * .1) * ctr, 10);
        yLoc = parseInt(yDim * .1 * ctr, 10);
        coord = this.pick(xLoc, yLoc, true);
        if (coord) {
            points.push(coord);
        }

        xLoc = parseInt(xDim - (xDim * .1) * ctr, 10);
        yLoc = parseInt(yDim - (yDim * .1) * ctr, 10);
        coord = this.pick(xLoc, yLoc, true);
        if (coord) {
            points.push(coord);
        }

        xLoc = parseInt(xDim * .1 * ctr, 10);
        yLoc = parseInt(yDim - (yDim * .1) * ctr, 10);
        coord = this.pick(xLoc, yLoc, true);
        if (coord) {
            points.push(coord);
        }
    }

    if (points < 2) {
        return false;
    }

    index = 0;
    for (ctr = 0; ctr < points.length; ctr += 1) {
        if (points[ctr].depth < points[index].depth) {
            index = ctr;
        }
    }

    finalPoints.push(points[index].coordinate);
    points.splice(index, 1);

    index = 0;
    for (ctr = 0; ctr < points.length; ctr += 1) {
        if (points[ctr].depth < points[index].depth) {
            index = ctr;
        }
    }

    finalPoints.push(points[index].coordinate);

    this.rulerPoints[0] = finalPoints[0][0];
    this.rulerPoints[1] = finalPoints[0][1];
    this.rulerPoints[2] = finalPoints[0][2];
    this.rulerPoints[3] = finalPoints[1][0];
    this.rulerPoints[4] = finalPoints[1][1];
    this.rulerPoints[5] = finalPoints[1][2];

    return true;
};



papaya.viewer.Volume3D.prototype.findPickedColor = function (gl) {
    var index;
    gl.readPixels(0, 0, gl.viewportWidth, gl.viewportHeight, gl.RGBA, gl.UNSIGNED_BYTE, this.pickingBuffer);
    index = (gl.viewportHeight - 1 - this.pickLocY) * gl.viewportWidth * 4 + this.pickLocX * 4;
    return [this.pickingBuffer[index], this.pickingBuffer[index + 1], this.pickingBuffer[index + 2]];
};



papaya.viewer.Volume3D.prototype.getBackgroundColor = function () {
    return ("rgba(" + parseInt((this.backgroundColor[0] * 255) + 0.5) + ',' +
        parseInt((this.backgroundColor[1] * 255) + 0.5) + ',' +
        parseInt((this.backgroundColor[2] * 255) + 0.5) + ',255)');
};



papaya.viewer.Volume3D.prototype.updatePreferences = function () {
    this.updateBackgroundColor();
};



papaya.viewer.Volume3D.prototype.updateBackgroundColor = function () {
    var colorName = this.viewer.container.preferences.surfaceBackgroundColor;

    if (colorName === "Black") {
        this.backgroundColor = [0, 0, 0];
    } else if (colorName === "Dark Gray") {
        this.backgroundColor = [0.25, 0.25, 0.25];
    } else if (colorName === "Gray") {
        this.backgroundColor = [0.5, 0.5, 0.5];
    } else if (colorName === "Light Gray") {
        this.backgroundColor = [0.75, 0.75, 0.75];
    } else if (colorName === "White") {
        this.backgroundColor = [1, 1, 1];
    } else {
        this.backgroundColor = papaya.viewer.Volume3D.DEFAULT_BACKGROUND;
    }
};



papaya.viewer.Volume3D.prototype.isMainView = function () {
    return (this.viewer.mainImage === this.viewer.volumeView);
};



papaya.viewer.Volume3D.prototype.processParams = function (params) {
    if (!this.viewer.container.isDesktopMode()) {
        if (params.surfaceBackground !== undefined) {
            this.viewer.container.preferences.surfaceBackgroundColor = params.surfaceBackground;
        }
    }
};



// adapted from: http://learningwebgl.com/blog/?p=1253
papaya.viewer.Volume3D.prototype.makeSphere = function (latitudeBands, longitudeBands, radius) {
    var latNumber, longNumber;
    var vertexPositionData = [];
    var normalData = [];

    for (latNumber = 0; latNumber <= latitudeBands; latNumber++) {
        var theta = latNumber * Math.PI / latitudeBands;
        var sinTheta = Math.sin(theta);
        var cosTheta = Math.cos(theta);

        for (longNumber = 0; longNumber <= longitudeBands; longNumber++) {
            var phi = longNumber * 2 * Math.PI / longitudeBands;
            var sinPhi = Math.sin(phi);
            var cosPhi = Math.cos(phi);

            var x = cosPhi * sinTheta;
            var y = cosTheta;
            var z = sinPhi * sinTheta;
            //var u = 1 - (longNumber / longitudeBands);
            //var v = 1 - (latNumber / latitudeBands);

            normalData.push(x);
            normalData.push(y);
            normalData.push(z);
            vertexPositionData.push(radius * x);
            vertexPositionData.push(radius * y);
            vertexPositionData.push(radius * z);
        }
    }

    var indexData = [];
    for (latNumber = 0; latNumber < latitudeBands; latNumber++) {
        for (longNumber = 0; longNumber < longitudeBands; longNumber++) {
            var first = (latNumber * (longitudeBands + 1)) + longNumber;
            var second = first + longitudeBands + 1;
            indexData.push(first);
            indexData.push(second);
            indexData.push(first + 1);

            indexData.push(second);
            indexData.push(second + 1);
            indexData.push(first + 1);
        }
    }

    return {vertices:vertexPositionData, normals:normalData, indices:indexData};
};



papaya.viewer.Volume3D.prototype.getRulerLength = function () {
    return papaya.utilities.MathUtils.lineDistance3d(this.rulerPoints[0], this.rulerPoints[1],
        this.rulerPoints[2], this.rulerPoints[3], this.rulerPoints[4], this.rulerPoints[5]);
};
