function GameManager(size, InputManager, Actuator, StorageManager) {
  this.size           = size; // Size of the grid
  this.inputManager   = new InputManager;
  this.storageManager = new StorageManager;
  this.actuator       = new Actuator;

  this.startTiles     = 2;

  this.inputManager.on("move", this.move.bind(this));
  this.inputManager.on("restart", this.restart.bind(this));
  this.inputManager.on("keepPlaying", this.keepPlaying.bind(this));

  this.setup();
}

GameManager.prototype.printboard=function(xpos,ypos){//Arguments are used to highlight spawn tile
  var grid=this.grid.cells;
  grid=grid.map(x=>x.map(y=>this.tile2text(y)));
  if(xpos>=0&&ypos>=0){//Highlight spawn tile
    var s=grid[xpos][ypos].split("");
    s[1]="<";
    grid[xpos][ypos]=s.join("");
  }
  for(var i=0;i<3;i++){
    for(var j=i+1;j<4;j++){
      grid[i][j]=[grid[j][i],grid[j][i]=grid[i][j]][0];//Transpose because the board is internally stored columnwise while we need to print rowwise
    }
  }
  grid=grid.map(x=>x.join("")).join("\n");
  var log=document.getElementById("log");
  log.value+="\n\n"+grid;
  log.scrollTop=log.scrollHeight;
  return grid;
};

GameManager.prototype.parsechar=function(char){
  if(char==="g"){
    return 65536;
  }
  var value=1<<(("0x"+char)*1);//This turns "1" into 2, "2" into 4, "3" into 8, and so on by interpreting char as a hex digit. This breaks on g=65536 so we hardcode that case in.
  if(value===1){//If hex interpretation fails or if char is just 0, then we just return 0 (blank).
    return 0;
  }else{
    return value;
  }
};

GameManager.prototype.addfixedtile = function (value,x,y) {
  if(value===0){//0=blank
    return;
  }
  var tile = new Tile({x:x,y:y}, value);
  this.grid.insertTile(tile);
};

// Restart the game
GameManager.prototype.restart = function () {
  this.storageManager.clearGameState();
  this.actuator.continueGame(); // Clear the game won/lost message
  this.setup();

  this.printboard();
};

// Keep playing after winning (allows going over 2048)
GameManager.prototype.keepPlaying = function () {
  this.keepPlaying = true;
  this.actuator.continueGame(); // Clear the game won/lost message
};

// Return true if the game is lost, or has won and the user hasn't kept playing
GameManager.prototype.isGameTerminated = function () {
  return this.over || (this.won && !this.keepPlaying);
};

// Set up the game
GameManager.prototype.setup = function () {
  var previousState = this.storageManager.getGameState();

  // Reload the game from a previous game if present
  if (previousState) {
    this.grid        = new Grid(previousState.grid.size,
                                previousState.grid.cells); // Reload grid
    this.score       = previousState.score;
    this.over        = previousState.over;
    this.won         = previousState.won;
    this.keepPlaying = previousState.keepPlaying;
  } else {
    this.grid        = new Grid(this.size);
    this.score       = 0;
    this.over        = false;
    this.won         = false;
    this.keepPlaying = false;

    // Add the initial tiles
    this.addStartTiles();
  }

  // Update the actuator
  this.actuate();
};

// Set up the initial tiles to start the game with
GameManager.prototype.addStartTiles = function () {
  /*for (var i = 0; i < this.startTiles; i++) {
    this.addRandomTile();
  }*/
  var p=document.getElementById("PLI").value;//If this is a 2048verse practice link, then p is what's actually in the field (the part after "/p/")
  p=p.split("/").pop();//If this is a 2048verse link then this gets the field value; if this was just the field value then it will still be the field value
  if(p.length<16){//If the input is less than 16 chars long, pad it with zeroes
    p+="0".repeat(16-p.length);
  }
  p=p.substring(0,16);//If the input is more than 16 chars long, trim it
  p=p.split("");
  p=p.map(x=>this.parsechar(x));
  for(var x=0;x<4;x++){
    for(var y=0;y<4;y++){
      var i=(x<<2)+y;
      this.addfixedtile(p[i],x,y);
    }
  }
};

// Adds a tile in a random position
GameManager.prototype.addRandomTile = function () {
  if (this.grid.cellsAvailable()) {
    var value = Math.random() < 0.9 ? 2 : 4;
    var cell=this.grid.randomAvailableCell();
    var tile = new Tile(cell, value);
    this.grid.insertTile(tile);
    return cell;
  }
  return {x:-1,y:-1};//I don't know if this ever happens but I don't want this to crash if it does
};

// Sends the updated grid to the actuator
GameManager.prototype.actuate = function () {
  if (this.storageManager.getBestScore() < this.score) {
    this.storageManager.setBestScore(this.score);
  }

  // Clear the state when the game is over (game over only, not win)
  if (this.over) {
    this.storageManager.clearGameState();
  } else {
    this.storageManager.setGameState(this.serialize());
  }

  this.actuator.actuate(this.grid, {
    score:      this.score,
    over:       this.over,
    won:        this.won,
    bestScore:  this.storageManager.getBestScore(),
    terminated: this.isGameTerminated()
  });

};

// Represent the current game as an object
GameManager.prototype.serialize = function () {
  return {
    grid:        this.grid.serialize(),
    score:       this.score,
    over:        this.over,
    won:         this.won,
    keepPlaying: this.keepPlaying
  };
};

// Save all tile positions and remove merger info
GameManager.prototype.prepareTiles = function () {
  this.grid.eachCell(function (x, y, tile) {
    if (tile) {
      tile.mergedFrom = null;
      tile.savePosition();
    }
  });
};

// Move a tile and its representation
GameManager.prototype.moveTile = function (tile, cell) {
  this.grid.cells[tile.x][tile.y] = null;
  this.grid.cells[cell.x][cell.y] = tile;
  tile.updatePosition(cell);
};

// Move tiles on the grid in the specified direction
GameManager.prototype.move = function (direction) {
  // 0: up, 1: right, 2: down, 3: left
  document.getElementById("log").value+=["up","right","down","left"][direction];//Log movement
  var self = this;

  if (this.isGameTerminated()) return; // Don't do anything if the game's over

  var cell, tile;

  var vector     = this.getVector(direction);
  var traversals = this.buildTraversals(vector);
  var moved      = false;

  // Save the current tile positions and remove merger information
  this.prepareTiles();

  // Traverse the grid in the right direction and move tiles
  traversals.x.forEach(function (x) {
    traversals.y.forEach(function (y) {
      cell = { x: x, y: y };
      tile = self.grid.cellContent(cell);

      if (tile) {
        var positions = self.findFarthestPosition(cell, vector);
        var next      = self.grid.cellContent(positions.next);

        // Only one merger per row traversal?
        if (next && next.value === tile.value && !next.mergedFrom) {
          var merged = new Tile(positions.next, tile.value * 2);
          merged.mergedFrom = [tile, next];

          self.grid.insertTile(merged);
          self.grid.removeTile(tile);

          // Converge the two tiles' positions
          tile.updatePosition(positions.next);

          // Update the score
          self.score += merged.value;

          // The mighty 2048 tile
          //if (merged.value === 2048) self.won = true;
        } else {
          self.moveTile(tile, positions.farthest);
        }

        if (!self.positionsEqual(cell, tile)) {
          moved = true; // The tile moved from its original cell!
        }
      }
    });
  });

  if (moved) {
    var cell=this.addRandomTile();
    this.printboard(cell.x,cell.y);

    if (!this.movesAvailable()) {
      this.over = true; // Game over!
    }

    this.actuate();
  }
};

// Get the vector representing the chosen direction
GameManager.prototype.getVector = function (direction) {
  // Vectors representing tile movement
  var map = {
    0: { x: 0,  y: -1 }, // Up
    1: { x: 1,  y: 0 },  // Right
    2: { x: 0,  y: 1 },  // Down
    3: { x: -1, y: 0 }   // Left
  };

  return map[direction];
};

// Build a list of positions to traverse in the right order
GameManager.prototype.buildTraversals = function (vector) {
  var traversals = { x: [], y: [] };

  for (var pos = 0; pos < this.size; pos++) {
    traversals.x.push(pos);
    traversals.y.push(pos);
  }

  // Always traverse from the farthest cell in the chosen direction
  if (vector.x === 1) traversals.x = traversals.x.reverse();
  if (vector.y === 1) traversals.y = traversals.y.reverse();

  return traversals;
};

GameManager.prototype.findFarthestPosition = function (cell, vector) {
  var previous;

  // Progress towards the vector direction until an obstacle is found
  do {
    previous = cell;
    cell     = { x: previous.x + vector.x, y: previous.y + vector.y };
  } while (this.grid.withinBounds(cell) &&
           this.grid.cellAvailable(cell));

  return {
    farthest: previous,
    next: cell // Used to check if a merge is required
  };
};

GameManager.prototype.movesAvailable = function () {
  return this.grid.cellsAvailable() || this.tileMatchesAvailable();
};

// Check for available matches between tiles (more expensive check)
GameManager.prototype.tileMatchesAvailable = function () {
  var self = this;

  var tile;

  for (var x = 0; x < this.size; x++) {
    for (var y = 0; y < this.size; y++) {
      tile = this.grid.cellContent({ x: x, y: y });

      if (tile) {
        for (var direction = 0; direction < 4; direction++) {
          var vector = self.getVector(direction);
          var cell   = { x: x + vector.x, y: y + vector.y };

          var other  = self.grid.cellContent(cell);

          if (other && other.value === tile.value) {
            return true; // These two tiles can be merged
          }
        }
      }
    }
  }

  return false;
};

GameManager.prototype.positionsEqual = function (first, second) {
  return first.x === second.x && first.y === second.y;
};

GameManager.prototype.tile2text=function(tile){
  if(tile===null){//Null tiles imply empty spaces
    return "_   ";
  }
  tile=tile.value;
  if(tile<1024){//512 and lower are just themselves in text
    tile+="";
  }else{//We just use "k" notation for lack of better words
    tile=Math.floor(tile/1000)+"k";
  }
  tile+=" ".repeat(4-tile.length);//Each tile is 3 chars wide in text plus spaces
  return tile;
};
