
///<reference lib="es2015.symbol" />
///<reference lib="es2015.symbol.wellknown" />
///<reference lib="es2015.collection" />
///<reference lib="es2015.iterable" />


import { movePlayerTo } from "@decentraland/RestrictedActions";
import * as ui from '@dcl/ui-scene-utils';

import { DistanceConstraint } from "cannon";
import { getUserData, UserData } from '@decentraland/Identity'
import { getCurrentRealm } from "@decentraland/EnvironmentAPI"

import { Utils } from "src/utils"
import { Client, Room } from "colyseus.js";


class Stage extends Entity implements ISystem {

    public world:CANNON.World;
    public camerabox;
    public FIXED_TIME_STEPS = 1.0 / 60;
    public MAX_TIME_STEPS = 10;
    
    public cannon_dynamics          = [];
    public cannon_movable_statics   = [];
    public cannon_pendulums         = [];
    public cannon_pickables         = [];
    public cannon_materials         = [];
    public materials                = [];
    public button_states            = {};
    public player_objects           = {};
    

    public move_force       = 6.5;
    public jump_velocity    = 4.2;

    public checkpoints      = [
        new Vector3(  8  ,  4.5,  8 ),
        new Vector3( 15.2  ,  8.8, 15.5 ),
        new Vector3(  14   , 12.7,   51 ),
        new Vector3(   35  , 21.3,   26 ),
        new Vector3(   13, 21.3 , 16),
        new Vector3(   5.6,  23.1 , 16)        
    ];

    public cur_checkpoint_index = 0;
    
    public grapple_max_length = 6;
    public grapple_min_length = 0.3;
    public sounds = {};
    public lives = 5;
    public time  = 0;
    public userData: UserData;
    
    public ui_msg;
    public ui_lives; 
    public ui_time;
    public ui_mode;
    public game_completed = 0;

    public lblhighscore = [];
    public salt = "gamejam2022";
    public common_box;
    public common_sphere;
    public common_billboard = new Billboard();



    public colyseus_room = null;
    
    public ID_PLAYER = 1000;
    public ID_CRATE  = 2000;
    public ID_LAUNCHPAD = 3000;
    public ID_WINNINGFLAG = 4000;
    public ID_EXTRALIFE = 5000;
    public ID_GRAPPLE = 6200;
    public ID_PENDULUM_BALL = 7000;

    public instruction_A = "Instructions: \nUse W,A,S,D to steer the ball. Space to jump, Num1 to Restart, Num2 to Join/Leave Multiplayer Server."
    public instruction_B = "To use the Grapple Hook, left click to launch the hook. Hold the left mouse to hold on to the rope. Release the left mouse to release the hook.\nThe hook is always launched upward direction. You can use W,A,S,D + left click to influence the direction when the hook is launched";


    //-------------
    constructor() {
        
        super();        

        this.init_materials();
        this.init_entities();
        this.init_inputs();    
        this.init_modarea();
        this.init_sounds();

        this.displayHighscores();

       
        
        engine.addEntity(this);
        engine.addSystem(this);
    }












    //---------
    create_ground( physicsMaterial ) {

        let sea_plane = new GLTFShape("models/sea_plane.glb")
        let groundobj = new Entity();
        groundobj.addComponent( new Transform({
            position: new Vector3(32, 0 ,32),
            scale: new Vector3( 1 ,1,  1)
        }))
        groundobj.addComponent( sea_plane );
        engine.addEntity( groundobj );
        

        let cannonbody = new CANNON.Body({
            mass: 0, 
            type: CANNON.Body.STATIC,
            position: new CANNON.Vec3( 0, -2 , 0 ),    // 0 -2 0 
            shape: new CANNON.Plane()
        })
        cannonbody.quaternion.setFromEuler(-Math.PI / 2 , 0,0);
        cannonbody.material = physicsMaterial
        cannonbody.linearDamping = 0.1
        cannonbody.angularDamping = 0.1
        this.world.addBody( cannonbody) 
    }













    //-----------------------------------------------
    create_static_objects( x, y, z, sx, sy, sz , rw, rx,ry,rz, shape , physicsMaterial , colorMaterial = null , cannon_shape = null , is_movable = 0 ) {

        let staticobj = new Entity();
        staticobj.setParent( this );
        staticobj.addComponent( new Transform({
            position: new Vector3(x,y,z),
            scale: new Vector3( sx , sy , sz )
        }) )



        if ( colorMaterial != null ) {
            staticobj.addComponent( colorMaterial );
        }
        staticobj.getComponent( Transform).rotation.w = rw ;
        staticobj.getComponent( Transform).rotation.x = rx ;
        staticobj.getComponent( Transform).rotation.y = ry ;
        staticobj.getComponent( Transform).rotation.z = rz ;
        
        staticobj.addComponent( shape );

        
        if ( shape.constructor.name == "BoxShape") {
            staticobj.getComponent( BoxShape ).withCollisions = false;
        } else if ( shape.constructor.name == "GLTFShape") {
            staticobj.getComponent( GLTFShape ).withCollisions = false;
        } else if ( shape.constructor.name == "CylinderShape" ) {
            staticobj.getComponent( CylinderShape ).withCollisions = false;
        }           
    

        if ( cannon_shape == null ) {
            cannon_shape = new CANNON.Box( new CANNON.Vec3( sx/2 , sy/2 , sz/2 ) )
        }

        let cannonbody = new CANNON.Body({
            mass: 0, // kg
            position: new CANNON.Vec3( x,y,z ), // m
            shape: cannon_shape
        })
        cannonbody.material = physicsMaterial
        cannonbody.linearDamping = 0.1
        cannonbody.angularDamping = 0.1
        staticobj["cannonbody"] = cannonbody;
        
        if ( is_movable == 1 ) {
            
            staticobj["ry"] = 0 ;
            this.cannon_movable_statics.push( staticobj );  
            
        } 
        this.copy_transform_quaternion_only_from_dcl_to_cannonbody( staticobj );
        this.world.addBody( cannonbody) // Add ball body to the world
        
        
        return staticobj;
    }






    //-----------------------------------------------
    create_dynamic_objects( x, y, z, sx,sy,sz, shape, cannon_shape, mass , physicsMaterial , cannonbody_id ) {
        
        let dyObj = new Entity();
        dyObj.setParent( this );
        dyObj.addComponent( new Transform({
            position: new Vector3(x, y ,z),
            scale: new Vector3( sx ,sy  ,sz )
        }) )
        dyObj.addComponent( shape );
        dyObj["ori_pos"] = new Vector3( x,y, z) ;
        
        let cannonbody = new CANNON.Body({
            mass: mass, // kg
            position: new CANNON.Vec3( x,y ,z ), // m
            shape: cannon_shape
        })

        cannonbody.material = physicsMaterial
        cannonbody.linearDamping = 0.1
        cannonbody.angularDamping = 0.1
        cannonbody.id = cannonbody_id;


        dyObj["cannonbody"] = cannonbody;
        
        this.world.addBody( cannonbody) 

        if ( cannonbody_id != this.ID_PLAYER ) {
            this.cannon_dynamics.push( dyObj );
        }

        return dyObj;

    }

    
    







    //----------
    createUI() {

        let ui_2d_canvas = new UICanvas();

        let ui_root = new UIContainerRect( ui_2d_canvas );
        ui_root.vAlign = "top";
		ui_root.hAlign = "left";
        ui_root.positionX = 200;
        ui_root.positionY = 0;
        
        let ui_msg = new UIText( ui_root );
        ui_msg.vAlign = "top";
		ui_msg.hAlign = "left";
		ui_msg.hTextAlign = "left";
        ui_msg.vTextAlign = "top";
		ui_msg.positionX =  0;
		ui_msg.positionY = 0;
        ui_msg.value = this.instruction_A ;
        ui_msg.fontSize = 10;
		ui_msg.visible = true;
        this.ui_msg = ui_msg;

        let ui_lives = new UIText( ui_root );
        ui_lives.vAlign = "top";
		ui_lives.hAlign = "left";
		ui_lives.hTextAlign = "left";
        ui_lives.vTextAlign = "top";
		ui_lives.positionX =  0;
		ui_lives.positionY = 60;
        ui_lives.value = "Lives: " + this.lives;
        ui_lives.fontSize = 15;
		ui_lives.visible = true;
        this.ui_lives = ui_lives;

        let ui_time = new UIText( ui_root );
        ui_time.vAlign = "top";
		ui_time.hAlign = "left";
		ui_time.hTextAlign = "left";
        ui_time.vTextAlign = "top";
		ui_time.positionX =  0;
		ui_time.positionY = 30;
        ui_time.value = "Time : " + this.time + " seconds.";
        ui_time.fontSize = 15;
		ui_time.visible = true;
        this.ui_time = ui_time;


        let ui_mode = new UIText( ui_root );
        ui_mode.vAlign = "top";
		ui_mode.hAlign = "left";
		ui_mode.hTextAlign = "left";
        ui_mode.vTextAlign = "top";
		ui_mode.positionX =  200;
		ui_mode.positionY = 60;
        ui_mode.value = "Mode: Single Player" ;
        ui_mode.fontSize = 15;
		ui_mode.visible = true;
        this.ui_mode = ui_mode;

		
    }



    //-----
    copy_transform_quaternion_only_from_dcl_to_cannonbody( ent ) {

        ent["cannonbody"].quaternion.w = ent.getComponent(Transform).rotation.w ;
        ent["cannonbody"].quaternion.x = ent.getComponent(Transform).rotation.x ;
        ent["cannonbody"].quaternion.y = ent.getComponent(Transform).rotation.y ;
        ent["cannonbody"].quaternion.z = ent.getComponent(Transform).rotation.z ;

    }

    //----
    copy_transform_from_dcl_to_cannonbox( ent ) {
        
        ent["cannonbody"].position.x = ent.getComponent(Transform).position.x ;
        ent["cannonbody"].position.y = ent.getComponent(Transform).position.y ;
        ent["cannonbody"].position.z = ent.getComponent(Transform).position.z ;
        ent["cannonbody"].quaternion.w = ent.getComponent(Transform).rotation.w ;
        ent["cannonbody"].quaternion.x = ent.getComponent(Transform).rotation.x ;
        ent["cannonbody"].quaternion.y = ent.getComponent(Transform).rotation.y ;
        ent["cannonbody"].quaternion.z = ent.getComponent(Transform).rotation.z ;
    }



    //-----------------
    async setUserData() {
        const data = await getUserData()
        log(data.displayName)
        this.userData = data
    }

    //----------------------
    async update_highscore() {
        
        let url = "https://tensaistudio.xyz/parkor/update_highscore.rvt";
       	
       	if (!this.userData) {
   			await this.setUserData()
  		}	

        let body = JSON.stringify({
			useraddr : this.userData.userId,
            username : this.userData.displayName,
            score : this.time,
            sig: Utils.sha256(this.userData.userId + this.salt + this.time )
		})

        let fetchopt = {
            headers: {
              'content-type': 'application/json'
            },
            body: body,
            method: 'POST'
        };
        
        
        try {
            
            let resp = await fetch(url, fetchopt ).then(response => response.json())
            log("JDEBUG", "update_highscore", "Sent request to URL", url , "SUCCESS", resp );
            this.displayHighscores();


        } catch(err) {
            log("error to do", url, fetchopt, err );
        }
    }



    //-----------------------
    displayHighscores() {

        let url = "https://tensaistudio.xyz/parkor/get_highscore.tcl";
        let fetchopt = {
            headers: {
              'content-type': 'application/json'
            },
            method: 'GET'
        };

        executeTask(async () => {
            try {
                let resp = await fetch(url, fetchopt ).then(response => response.json())
            
                log("sent request to URL", url , "SUCCESS", resp );
                let str = [];
                let i;
                let kcount = 0;
                for ( i = 0 ; i < resp.length  ; i++ ) {
                	
                	let k = (i / 25) >> 0;
                	if ( str[k] == null ) {
                		str[k] = "";
                    	kcount += 1;
                    }
                    str[k] += ( i + 1 ) + "." + " " + resp[i]["username"] + "     " + this.format_time( resp[i]["score"] ) + "\n";
                }
                this.lblhighscore[0].getComponent(TextShape).value = "Highscores\n\n"
                this.lblhighscore[0].getComponent(TextShape).value += str[0];
                if ( kcount >= 2 ) {
                	this.lblhighscore[1].getComponent(TextShape).value = "\n\n\n" + str[1];
                }
                if ( kcount >= 3 ) {
                	this.lblhighscore[2].getComponent(TextShape).value = "\n\n\n" + str[2];
                }

            } catch(err) {
                log("error to do", url, fetchopt, err );
            }
        });
    }


    //-------
    init_cannon_eventhdls() {
        
        var upVector        = new CANNON.Vec3(0, 1, 0);
        var contactNormal   = new CANNON.Vec3(0, 0, 0);

        let _this = this;


        let mainballbody:CANNON.Body = _this.player_objects["self"]["cannonbody"];
        /*
        mainballbody.addEventListener("collide", function(e) {
            var relativeVelocity = e.contact.getImpactVelocityAlongNormal();            
            if( Math.abs(relativeVelocity) > 3 ){
                // More energy
            } 
        
        });
        */


        this.world.addEventListener("postStep", function(e) {

            if ( _this.colyseus_room == null ) {

                _this.player_objects["self"]["grounded"] = 0;
                
                if ( _this.world.contacts.length > 0 ) {

                    for( let i = 0; i < _this.world.contacts.length; i++) {

                        var contact = _this.world.contacts[i];

                        if ( contact.bi.id == _this.ID_PLAYER || contact.bj.id == _this.ID_PLAYER ) {
                        
                            if( contact.bi.id == _this.ID_PLAYER ) {

                                contact.ni.negate(contactNormal);
                            } else {

                                contact.ni.copy(contactNormal);
                            }
                            _this.player_objects["self"]["grounded"] = ( contactNormal.dot(upVector) > 0.5 ) ? 1 : 0 ;
                            

                            if ( contact.bi.id == _this.ID_CRATE || contact.bj.id == _this.ID_CRATE ) { 
                                
                                //let relativeVelocity = contact.getImpactVelocityAlongNormal(); 
                                //if( Math.abs(relativeVelocity) > 0.1 ){
                                //    _this.sounds["crate"].playOnce();
                                //} 
                            
                            } else if ( contact.bi.id == _this.ID_LAUNCHPAD || contact.bj.id ==  _this.ID_LAUNCHPAD ) {
                                
                                if ( _this.player_objects["self"]["grounded"] == 1 ) {
                                    _this.player_objects["self"]["cannonbody"].velocity.y = _this.jump_velocity * 5;
                                }

                            } else if (  contact.bi.id == _this.ID_EXTRALIFE  ) {
                                contact.bi.position.y = -500;
                                _this.add_life(1);

                                
                            } else if ( contact.bj.id == _this.ID_EXTRALIFE ) {
                                
                                contact.bj.position.y = -500;
                                _this.add_life(1);
                                
                                
                            } else if ( contact.bi.id == _this.ID_WINNINGFLAG ) {
                                contact.bi.position.y = -500;
                                _this.win_game();
                            } else if ( contact.bj.id == _this.ID_WINNINGFLAG ) {
                                contact.bj.position.y = -500;
                                _this.win_game();
                            }
                        
                        } else if ( contact.bi.id == _this.ID_GRAPPLE || contact.bj.id == _this.ID_GRAPPLE ) {

                            if ( _this.player_objects["self"]["grapple_state"] == 2 ) {
                                log("Grapple hooked!")
                                _this.player_objects["self"]["grapple_cannonbody_static"].position.set( 
                                    _this.player_objects["self"]["grapple_cannonbody_dynamic"].position.x, 
                                    _this.player_objects["self"]["grapple_cannonbody_dynamic"].position.y, 
                                    _this.player_objects["self"]["grapple_cannonbody_dynamic"].position.z 
                                );
                                _this.create_constraint();
                                _this.player_objects["self"]["grapple_state"] = 1;
                            }
                        }

                        
                    }
                }
            }
        });
    }
    


    //-------
    async init_entities() {

        if ( !this.userData) {
            await this.setUserData()
        }	

        let world = new CANNON.World()
        world.quatNormalizeSkip = 0
        world.quatNormalizeFast = false
        world.gravity.set(0, -7, 0)
        this.world = world;

        

        
        this.addComponent( new Transform({
            position: new Vector3( 12 ,2 , 0 ),
            scale: new Vector3( 1, 1, 1)
        }))
        
        
        let cannon_material_normal   = this.cannon_materials[0];
        let cannon_material_low_fric = this.cannon_materials[1];
        let cannon_material_high_fric = this.cannon_materials[2];

        
        
        // Ground
        this.create_ground( cannon_material_low_fric );


        // Shapes
        let common_box      = new BoxShape();
        let common_sphere   = new SphereShape();

        
        // GLBs
        let translucent_platform = new GLTFShape("models/translucent_platform.glb");
        let translucent_platform2 = new GLTFShape("models/translucent_platform2.glb");
        let green_platform = new GLTFShape("models/green_platform.glb");
        let green_platform2 = new GLTFShape("models/green_platform2.glb");
        let wooden_platform = new GLTFShape("models/wooden_platform.glb");
        let wooden_platform2 = new GLTFShape("models/wooden_platform2.glb");
        let wooden_platform3 = new GLTFShape("models/wooden_platform3.glb");
        let iron_platform    = new GLTFShape("models/iron_platform.glb");
        let cylinder_platform = new GLTFShape("models/cylinder_platform.glb");
        let launchpad_platform = new GLTFShape("models/launchpad_platform.glb");
        let ironball = new GLTFShape("models/ironball.glb");
        let checkerflag = new GLTFShape("models/checkerflag.glb");
        

        // Platforms

        /*P.001*/  this.create_static_objects( 8.0,4.0,8.0,    2.0,0.10000000149011612,2.0,    1.0,-0.0,-0.0,-0.0, green_platform , cannon_material_normal );
        /*P.002*/  this.create_static_objects( 10.979999542236328,3.7300000190734863,8.0,    4.0,0.10000000149011612,0.5,    0.9975518584251404,-0.0,-0.0,-0.06993057578802109, wooden_platform , cannon_material_normal );
        /*P.003*/  this.create_static_objects( 13.949999809265137,3.4200000762939453,8.0,    2.0,0.10000000149011612,2.0,    1.0,-0.0,-0.0,-0.0, green_platform , cannon_material_normal );
        /*P.004*/  this.create_static_objects( 14.0,3.4200000762939453,11.0,    0.5,0.10000000149011612,4.0,    1.0,-0.0,-0.0,-0.0, wooden_platform2 , cannon_material_normal );
        /*P.005*/  this.create_static_objects( 14.0,3.9000000953674316,13.5,    2.0,1.6,1.0,    1.0,-0.0,-0.0,-0.0, green_platform , cannon_material_normal );
        /*P.006*/  this.create_static_objects( 14.0,4.5,14.5,    2.0,1.0,1.0,    1.0,-0.0,-0.0,-0.0, green_platform , cannon_material_normal );
        /*P.007*/  this.create_static_objects( 10.757431030273438,3.006248712539673,14.5,    6.0,0.10000000894069672,0.5,    0.9323275685310364,0.0,0.0,0.3456, wooden_platform , cannon_material_normal );//P.007
        /*P.008*/  this.create_static_objects( 7.5221052169799805,0.8633368611335754,14.499990463256836,    2.0,0.1,0.5,    0.9950042366981506,0.0,0.0,0.0998329296708107, wooden_platform , cannon_material_normal );//P.008
        /*P.009*/  this.create_static_objects( 5.5505900382995605,0.6673597693443298,14.499998092651367,    2.0,0.1,0.5,    1.0,0.0,0.0,-0.0, wooden_platform , cannon_material_normal );//P.009
        /*P.010*/  this.create_static_objects( 3.5746734142303467,0.8704371452331543,14.5,    2.0,0.10000000894069672,0.5,    0.9950042963027954,0.0,0.0,-0.09983205795288086, wooden_platform , cannon_material_normal );//P.010
        /*P.011*/  this.create_static_objects( 2.1923024654388428,1.3453261852264404,14.5,    1.0,0.1,0.5,    0.9553366899490356,0.0,0.0,-0.2955196499824524, wooden_platform , cannon_material_normal );//P.011
        /*P.012*/  this.create_static_objects( -3.4,2.0,14.5,    3.2,0.10000000149011612,2.0,    1.0,-0.0,-0.0,-0.0, green_platform , cannon_material_normal );
        /*P.013*/  this.create_static_objects( -6,2.950000047683716,14.5,    2,2.0,2.0,    1.0,-0.0,-0.0,-0.0, green_platform , cannon_material_normal );
        /*P.014*/  this.create_static_objects( -4.0,2.0, 12.55,    0.20000000298023224,0.10000000149011612, 1.90000047683716,    1.0,-0.0,-0.0,-0.0, wooden_platform2 , cannon_material_normal );
        /*P.015*/  this.create_static_objects( -4.8755,2.0,11.5,    1.95 ,0.10000000149011612,0.20000000298023224,    1.0,-0.0,-0.0,-0.0, wooden_platform , cannon_material_normal );
        /*P.016*/  this.create_static_objects( -6.0,2.0,10.430000305175781,    0.30000001192092896,0.10000000149011612,2.3499999046325684,    1.0,-0.0,-0.0,-0.0, wooden_platform2 , cannon_material_normal );
        /*P.017*/  this.create_static_objects( -4.8763, 2.0,9.5,    1.950000047683716,0.10000000149011612,0.5,    1.0,-0.0,-0.0,-0.0, wooden_platform , cannon_material_normal );
        /*P.018*/  this.create_static_objects( 5.292481422424316,5.891871929168701,9.5,    20.0,0.10000000149011612,0.5,    0.9800665974617004,-0.0,-0.0,0.1986692249774933, wooden_platform3 , cannon_material_normal );
        /*P.019*/  this.create_static_objects( 15.199999809265137,8.0,11.5,    4,  0.1 ,6.0,    0.9950041174888611,-0.0,-0.0,0.09983379393815994, green_platform2 , cannon_material_normal );
        /*P.020*/  this.create_static_objects( 15.199999809265137,8.300000190734863,15.5,    2.0,1.0,2.0,    1.0,-0.0,-0.0,-0.0, green_platform , cannon_material_normal );
        /*P.021*/  this.create_static_objects( 7.0,12.0,15.5,    18.0,0.20000000298023224,1.0,    1.0,-0.0,-0.0,-0.0, translucent_platform , cannon_material_normal );
        /*P.022*/  this.create_static_objects( -4.7968010902404785,8.300000190734863,15.5,    2.0,1.0,2.0,    1.0,-0.0,-0.0,-0.0, green_platform , cannon_material_normal );
        /*P.023*/  this.create_static_objects( 0.13690003752708435,8.01220989227295,15.503496170043945,    2.0,0.10000000149011612,8.0,    -0.7039885520935059,-0.06633318960666656,-0.7039885520935059,0.06633318960666656, wooden_platform2 , cannon_material_normal );
        /*P.024*/  this.create_static_objects( -4.822173595428467,12.0,29.995723724365234,    18.0,0.20000000298023224,1.0,    0.7071067690849304,-0.0,-0.7071067690849304,-0.0, translucent_platform , cannon_material_normal );
        /*P.025*/  this.create_static_objects( -4.7968010902404785,8.300000190734863,44.059505462646484,    2.0,1.0,2.0,    1.0,-0.0,-0.0,-0.0, green_platform , cannon_material_normal );
        /*P.026*/  this.create_static_objects( -4.805766582489014,7.9936394691467285,39.130672454833984,    2.0,0.10000000149011612,8.0,    -1.6220222676111007e-07,-1.5283475818250736e-08,-0.9955902099609375,0.09380930662155151, wooden_platform2 , cannon_material_normal );
        /*P.027*/  this.create_static_objects( -4.0,8.510542869567871,51.01670837402344,    4.0,2.0,12.0,    1.0,-0.0,-0.0,-0.0, wooden_platform2 , cannon_material_normal );
        /*P.028*/  this.create_static_objects( -4.805766582489014,7.9936394691467285,20.421945571899414,    2.0,0.10000000149011612,8.0,    0.9955902099609375,0.09380930662155151,-0.0,0.0, wooden_platform2 , cannon_material_normal );
        /*P.029*/  this.create_static_objects( -1.8707183599472046,13.625,48.0,    0.25,0.25,6.0,    1.0,-0.0,-0.0,-0.0, common_box , cannon_material_normal );
        /*P.030*/  this.create_static_objects( -1.8718624114990234,13.625,54.25,    0.25,0.25,5.5,    1.0,-0.0,-0.0,-0.0, common_box , cannon_material_normal );
        /*P.031*/  this.create_static_objects( 4.0,11.5,51.0,    12.0,4.0,12.0,    1.0,-0.0,-0.0,-0.0, iron_platform , cannon_material_normal );
        /*P.032*/  this.create_static_objects( 9.826231956481934,13.625,47.546363830566406,    0.25,0.25,5.0,    1.0,-0.0,-0.0,-0.0, common_box , cannon_material_normal );
        /*P.033*/  this.create_static_objects( 9.796574592590332,13.625,54.41102600097656,    0.25,0.25,5.0,    1.0,-0.0,-0.0,-0.0, common_box , cannon_material_normal );
        /*P.034*/  this.create_static_objects( 4.0,13.625,56.846004486083984,    0.25,0.25,12.0,    0.7071067690849304,-0.0,-0.7071067690849304,-0.0, common_box , cannon_material_normal );
        /*P.035*/  this.create_static_objects( 4.0,13.625,45.150001525878906,    0.25,0.25,12.0,    0.7071067690849304,-0.0,-0.7071067690849304,-0.0, common_box , cannon_material_normal );
        /*P.036*/  this.create_static_objects( -0.9927014708518982,13.625,51.6212272644043,    0.25,0.25,2.0,    0.7071067690849304,-0.0,-0.7071067690849304,-0.0, common_box , cannon_material_normal );
        /*P.037*/  this.create_static_objects( -1.0477232933044434,13.625,48.48931884765625,    0.25,0.25,5.0,    1.0,-0.0,-0.0,-0.0, common_box , cannon_material_normal );
        /*P.038*/  this.create_static_objects( 0.7609188556671143,13.625,50.50371170043945,    0.25,0.25,9.0,    1.0,-0.0,-0.0,-0.0, common_box , cannon_material_normal );
        /*P.039*/  this.create_static_objects( -0.21842774748802185,13.625,52.442100524902344,    0.25,0.25,2.0,    0.7071067690849304,-0.0,-0.7071067690849304,-0.0, common_box , cannon_material_normal );
        /*P.040*/  this.create_static_objects( 0.8783197999000549,13.625,56.02077102661133,    0.25,0.25,4.0,    0.7071067690849304,-0.0,-0.7071067690849304,-0.0, common_box , cannon_material_normal );
        /*P.041*/  this.create_static_objects( 3.5455145835876465,13.625,48.73906326293945,    0.25,0.25,7.0,    1.0,-0.0,-0.0,-0.0, common_box , cannon_material_normal );
        /*P.042*/  this.create_static_objects( 2.6336450576782227,13.625,55.24249267578125,    0.25,0.25,2.0,    0.7071067690849304,-0.0,-0.7071067690849304,-0.0, common_box , cannon_material_normal );
        /*P.043*/  this.create_static_objects( 1.7088762521743774,13.625,49.2880973815918,    0.25,0.25,5.0,    1.0,-0.0,-0.0,-0.0, common_box , cannon_material_normal );
        /*P.044*/  this.create_static_objects( 2.640078544616699,13.625,47.8268928527832,    0.25,0.25,2.0,    0.7071067690849304,-0.0,-0.7071067690849304,-0.0, common_box , cannon_material_normal );
        /*P.045*/  this.create_static_objects( 2.6542868614196777,13.625,51.48262405395508,    0.25,0.25,4.0,    1.0,-0.0,-0.0,-0.0, common_box , cannon_material_normal );
        /*P.046*/  this.create_static_objects( 1.7075139284133911,13.625,46.15363693237305,    0.25,0.25,2.200000047683716,    0.7071067690849304,-0.0,-0.7071067690849304,-0.0, common_box , cannon_material_normal );
        /*P.047*/  this.create_static_objects( 3.0,14.0,51.0,    14.0,0.5,12.0,    1.0,-0.0,-0.0,-0.0, translucent_platform2 , cannon_material_normal );
        /*P.048*/  this.create_static_objects( 13.917327880859375,12.656153678894043,51.00114822387695,    2.0,0.10000000149011612,8.0,    -0.7039887309074402,-0.06633320450782776,-0.7039883732795715,0.06633317470550537, wooden_platform2 , cannon_material_normal );
        /*P.049*/  this.create_static_objects( -0.12748190760612488,13.625,49.278099060058594,    0.25,0.25,5.0,    1.0,-0.0,-0.0,-0.0, common_box , cannon_material_normal );
        /*P.050*/  this.create_static_objects( -0.167697936296463,13.625,46.1351318359375,    0.25,0.25,2.0,    0.7071067690849304,-0.0,-0.7071067690849304,-0.0, common_box , cannon_material_normal );
        /*P.051*/  this.create_static_objects( -0.9523428678512573,13.625,54.463069915771484,    0.25,0.25,2.0,    0.7071067690849304,-0.0,-0.7071067690849304,-0.0, common_box , cannon_material_normal );
        /*P.052*/  this.create_static_objects( -0.1283869743347168,13.625,55.09067916870117,    0.25,0.25,2.0,    0.7071067690849304,-0.0,-0.7071067690849304,-0.0, common_box , cannon_material_normal );
        /*P.053*/  this.create_static_objects( 3.513483762741089,13.625,54.37953567504883,    0.25,0.25,2.0,    1.0,-0.0,-0.0,-0.0, common_box , cannon_material_normal );
        /*P.054*/  this.create_static_objects( 1.6425912380218506,13.625,54.24979019165039,    0.25,0.25,2.0,    0.7071067690849304,-0.0,-0.7071067690849304,-0.0, common_box , cannon_material_normal );
        /*P.055*/  this.create_static_objects( 2.5706074237823486,13.625,53.481815338134766,    0.25,0.25,2.0,    0.7071067690849304,-0.0,-0.7071067690849304,-0.0, common_box , cannon_material_normal );
        /*P.056*/  this.create_static_objects( 1.759871482849121,13.625,55.64324951171875,    0.25,0.25,1.0,    1.0,-0.0,-0.0,-0.0, common_box , cannon_material_normal );
        /*P.057*/  this.create_static_objects( 2.646735191345215,13.625,46.55080795288086,    0.25,0.25,1.0,    1.0,-0.0,-0.0,-0.0, common_box , cannon_material_normal );
        /*P.058*/  this.create_static_objects( 4.443387985229492,13.625,50.62728500366211,    0.25,0.25,9.0,    1.0,-0.0,-0.0,-0.0, common_box , cannon_material_normal );
        /*P.059*/  this.create_static_objects( 5.391777038574219,13.625,46.23462677001953,    0.25,0.25,2.0,    0.7071067690849304,-0.0,-0.7071067690849304,-0.0, common_box , cannon_material_normal );
        /*P.060*/  this.create_static_objects( 6.230345726013184,13.625,45.66108322143555,    0.25,0.25,1.0,    1.0,-0.0,-0.0,-0.0, common_box , cannon_material_normal );
        /*P.061*/  this.create_static_objects( 1.6351642608642578,13.625,52.46269607543945,    0.25,0.25,2.0,    0.7071067690849304,-0.0,-0.7071067690849304,-0.0, common_box , cannon_material_normal );
        /*P.062*/  this.create_static_objects( 4.004051685333252,13.625,53.50653076171875,    0.25,0.25,1.0,    0.7071067690849304,-0.0,-0.7071067690849304,-0.0, common_box , cannon_material_normal );
        /*P.063*/  this.create_static_objects( 5.313923358917236,13.625,56.052127838134766,    0.25,0.25,2.0,    0.7071067690849304,-0.0,-0.7071067690849304,-0.0, common_box , cannon_material_normal );
        /*P.064*/  this.create_static_objects( 3.561173915863037,13.625,56.41191864013672,    0.25,0.25,1.0,    1.0,-0.0,-0.0,-0.0, common_box , cannon_material_normal );
        /*P.065*/  this.create_static_objects( 5.258968353271484,13.625,51.442867279052734,    0.25,0.25,9.0,    1.0,-0.0,-0.0,-0.0, common_box , cannon_material_normal );
        /*P.066*/  this.create_static_objects( 6.232084274291992,13.625,54.1571044921875,    0.25,0.25,2.0,    1.0,-0.0,-0.0,-0.0, common_box , cannon_material_normal );
        /*P.067*/  this.create_static_objects( 7.087845802307129,13.625,51.615867614746094,    0.25,0.25,9.0,    1.0,-0.0,-0.0,-0.0, common_box , cannon_material_normal );
        /*P.068*/  this.create_static_objects( 8.036247253417969,13.625,55.7635498046875,    0.25,0.25,2.0,    1.0,-0.0,-0.0,-0.0, common_box , cannon_material_normal );
        /*P.069*/  this.create_static_objects( 8.981213569641113,13.625,54.10236740112305,    0.25,0.25,4.0,    1.0,-0.0,-0.0,-0.0, common_box , cannon_material_normal );
        /*P.070*/  this.create_static_objects( 7.937376499176025,13.625,47.19849395751953,    0.25,0.25,2.0,    0.7071067690849304,-0.0,-0.7071067690849304,-0.0, common_box , cannon_material_normal );
        /*P.071*/  this.create_static_objects( 8.752957344055176,13.625,49.91709518432617,    0.25,0.25,2.0,    0.7071067690849304,-0.0,-0.7071067690849304,-0.0, common_box , cannon_material_normal );
        /*P.072*/  this.create_static_objects( 7.9042792320251465,13.625,54.17853546142578,    0.25,0.25,2.0,    0.7071067690849304,-0.0,-0.7071067690849304,-0.0, common_box , cannon_material_normal );
        /*P.073*/  this.create_static_objects( 8.925958633422852,13.625,51.1033935546875,    0.25,0.25,2.0,    0.7071067690849304,-0.0,-0.7071067690849304,-0.0, common_box , cannon_material_normal );
        /*P.074*/  this.create_static_objects( 8.085676193237305,13.625,52.2293701171875,    0.25,0.25,2.0,    1.0,-0.0,-0.0,-0.0, common_box , cannon_material_normal );
        /*P.075*/  this.create_static_objects( 8.18452262878418,13.625,49.02737045288086,    0.25,0.25,2.0,    0.7071067690849304,-0.0,-0.7071067690849304,-0.0, common_box , cannon_material_normal );
        /*P.076*/  this.create_static_objects( 8.678812980651855,13.625,48.11293411254883,    0.25,0.25,2.0,    0.7071067690849304,-0.0,-0.7071067690849304,-0.0, common_box , cannon_material_normal );
        /*P.077*/  this.create_static_objects( 8.481096267700195,13.625,46.20991134643555,    0.25,0.25,2.5,    0.7071067690849304,-0.0,-0.7071067690849304,-0.0, common_box , cannon_material_normal );
        /*P.078*/  this.create_static_objects( 7.169499397277832,13.625,46.229522705078125,    0.25,0.25,1.0,    1.0,-0.0,-0.0,-0.0, common_box , cannon_material_normal );
        /*P.079*/  this.create_static_objects( 6.207369804382324,13.625,51.01835632324219,    0.25,0.25,2.0,    1.0,-0.0,-0.0,-0.0, common_box , cannon_material_normal );
        /*P.080*/  this.create_static_objects( 6.25679874420166,13.625,48.12675476074219,    0.25,0.25,2.0,    1.0,-0.0,-0.0,-0.0, common_box , cannon_material_normal );
        /*P.081*/  this.create_static_objects( 7.070641040802002,13.625,56.31306076049805,    0.25,0.25,1.0,    1.0,-0.0,-0.0,-0.0, common_box , cannon_material_normal );
        /*P.082*/  this.create_static_objects( 5.713066577911377,13.625,53.32770538330078,    0.25,0.25,1.0,    0.7071067690849304,-0.0,-0.7071067690849304,-0.0, common_box , cannon_material_normal );
        /*P.083*/  this.create_static_objects( 5.787210464477539,13.625,50.18895721435547,    0.25,0.25,1.0,    0.7071067690849304,-0.0,-0.7071067690849304,-0.0, common_box , cannon_material_normal );
        /*P.084*/  this.create_static_objects( 5.811924934387207,13.625,49.00265884399414,    0.25,0.25,1.0,    0.7071067690849304,-0.0,-0.7071067690849304,-0.0, common_box , cannon_material_normal );
        /*P.085*/  this.create_static_objects( -0.9049433469772339,13.625,53.09428787231445,    0.25,0.25,2.0,    0.7071067690849304,-0.0,-0.7071067690849304,-0.0, common_box , cannon_material_normal );
        /*P.086*/  this.create_static_objects( -0.23150157928466797,13.625,53.742225646972656,    0.25,0.25,2.0,    0.7071067690849304,-0.0,-0.7071067690849304,-0.0, common_box , cannon_material_normal );
        /*P.087*/  this.create_static_objects( -1.0039149522781372,13.625,56.017173767089844,    0.25,0.25,0.699999988079071,    1.0,-0.0,-0.0,-0.0, common_box , cannon_material_normal );
        /*P.088*/  this.create_static_objects( 25.809492111206055,16.668949127197266,51.02899169921875,    20.0,0.20000000298023224,1.0,    0.9987636804580688,-0.0,-0.0,0.04971063509583473, translucent_platform , cannon_material_normal );
        /*P.089*/  this.create_static_objects( 34.44053649902344,18.43332290649414,45.60948944091797,    12.000000953674316,0.20000000298023224,1.0,    0.7019047737121582,0.08561351895332336,-0.7019047737121582,-0.08561352640390396, translucent_platform , cannon_material_normal );
        /*P.090*/  this.create_static_objects( 25.84488868713379,19.901655197143555,39.8708381652832,    20.000001907348633,0.20000001788139343,1.0,    0.9994516372680664,-0.0,-0.0,-0.03311162441968918, translucent_platform , cannon_material_normal );
        /*P.091*/  this.create_static_objects( 17.437633514404297,21.18353843688965,32.94257354736328,    15.0,0.20000000298023224,1.0,    0.704527735710144,0.06033780798316002,-0.704527735710144,-0.06033781170845032, translucent_platform , cannon_material_normal );
        /*P.092*/  this.create_static_objects( 25.93344497680664,23.3279972076416,26.1445369720459,    18.0,0.20000000298023224,1.0,    0.9974499940872192,-0.0,-0.0,0.07136891037225723, translucent_platform , cannon_material_normal );
        /*P.093*/  this.create_static_objects( 34.41682052612305,13.920989990234375,50.86177062988281,    2.0,1.0,2.0,    1.0,-0.0,-0.0,-0.0, green_platform , cannon_material_normal );
        /*P.094*/  this.create_static_objects( 34.38123321533203,15.640737533569336,39.97154235839844,    2.0,1.0,2.0,    1.0,-0.0,-0.0,-0.0, green_platform , cannon_material_normal );
        /*P.095*/  this.create_static_objects( 17.47646713256836,15.549286842346191,39.829185485839844,    2.0,1.0,2.0,    1.0,-0.0,-0.0,-0.0, green_platform , cannon_material_normal );
        /*P.096*/  this.create_static_objects( 17.353471755981445,18.36593246459961,26.176681518554688,    2.0,1.0,2.0,    1.0,-0.0,-0.0,-0.0, green_platform , cannon_material_normal );
        /*P.097*/  this.create_static_objects( 35, 20.791515350341797,25.99956703186035,    2.0,1.0,2.0,    1.0,-0.0,-0.0,-0.0, green_platform , cannon_material_normal );

        
        /*P.098*/  
        this.create_static_objects( 35, 20, 24,    2.0, 2.0, 2.0,    1.0,-0.0,-0.0,-0.0, iron_platform , cannon_material_high_fric , null, null , 1) ;
         /*P.099*/  
        this.create_static_objects( 35, 20, 22,    2.0, 2.0, 2.0,    1.0,-0.0,-0.0,-0.0, iron_platform , cannon_material_high_fric , null, null , 1) ;
        
         /*P.100*/  
        this.create_static_objects( 35, 20, 20,    2.0, 2.0, 2.0,    1.0,-0.0,-0.0,-0.0, iron_platform , cannon_material_high_fric , null, null , 1) ;
        
         /*P.101*/  
        this.create_static_objects( 35, 20, 18,    2.0, 2.0, 2.0,    1.0,-0.0,-0.0,-0.0, iron_platform , cannon_material_high_fric , null, null , 1) ;
        







        /*P.102*/  this.create_static_objects( 35, 20.791515350341797, 16,    2.0,1.0,2.0,    1.0,-0.0,-0.0,-0.0, green_platform , cannon_material_normal );
        
        /*P.103*/  this.create_static_objects( 24.0,21.240095138549805,16.0,    20.0,0.10000000149011612,0.5,    1.0,-0.0,-0.0,-0.0, wooden_platform3 , cannon_material_normal );
        
        /*P.104*/  this.create_static_objects( 12.997295379638672,20.791515350341797,16.0,    2.0,1.0,2.0,    1.0,-0.0,-0.0,-0.0, green_platform , cannon_material_normal );
        /*P.105*/  this.create_static_objects( 11.34156608581543,20.791515350341797,16.32428550720215,    1.0,1.0,0.20000000298023224,    1.0,-0.0,-0.0,-0.0, green_platform , cannon_material_normal );
        /*P.106*/  this.create_static_objects( 10.3341646194458,21.15713119506836,16.32428550720215,    1.0,1.0,0.20000000298023224,    1.0,-0.0,-0.0,-0.0, green_platform , cannon_material_normal );
        /*P.107*/  this.create_static_objects( 10.397639274597168,21.50531005859375,15.759941101074219,    1.0,1.0,0.20000000298023224,    1.0,-0.0,-0.0,-0.0, green_platform , cannon_material_normal );
        /*P.108*/  this.create_static_objects( 9.405525207519531,21.767881393432617,15.759941101074219,    1.0,1.0,0.20000000298023224,    1.0,-0.0,-0.0,-0.0, green_platform , cannon_material_normal );
        /*P.109*/  this.create_static_objects( 9.138103485107422,22.214923858642578,16.332210540771484,    1.0,1.0,0.20000000298023224,    1.0,-0.0,-0.0,-0.0, green_platform , cannon_material_normal );
        /*P.110*/  this.create_static_objects( 8.128583908081055,22.477495193481445,16.332210540771484,    1.0,1.0,0.20000000298023224,    1.0,-0.0,-0.0,-0.0, green_platform , cannon_material_normal );
        /*P.111*/  this.create_static_objects( 7.885519981384277,22.214923858642578,15.870732307434082,    1.0,1.0,0.20000000298023224,    1.0,-0.0,-0.0,-0.0, green_platform , cannon_material_normal );
        /*P.112*/  this.create_static_objects( 6.893208026885986,22.477495193481445,15.870732307434082,    1.0,1.0,0.20000000298023224,    1.0,-0.0,-0.0,-0.0, green_platform , cannon_material_normal );
        /*P.113*/  this.create_static_objects( 5.592547416687012,22.59523582458496,16.0,    2.0,1.0,2.0,    1.0,-0.0,-0.0,-0.0, green_platform , cannon_material_normal );
        /*P.114*/  this.create_static_objects( 9.831380844116211,22.1247501373291,15.535028457641602,    1.0,1.0,0.20000000298023224,    1.0,-0.0,-0.0,-0.0, green_platform , cannon_material_normal );
        /*P.115*/  this.create_static_objects( 8.871644973754883,22.496366500854492,16.55289077758789,    1.0,1.0,0.20000000298023224,    1.0,-0.0,-0.0,-0.0, green_platform , cannon_material_normal );
        /*P.116*/  this.create_static_objects( 7.519367218017578,22.54247283935547,15.658975601196289,    1.0,1.0,0.20000000298023224,    1.0,-0.0,-0.0,-0.0, green_platform , cannon_material_normal );



        // Launchpads
        /*P.117*/  
        let launchpad = this.create_static_objects( 5.573471546173096,23.058881759643555,17.55678939819336,    1.0,1.0,1.0,    1.0,-0.0,-0.0,-0.0, launchpad_platform , cannon_material_normal );
        launchpad["cannonbody"].id = this.ID_LAUNCHPAD;
        
        /*P.118*/  
        launchpad = this.create_static_objects( 5.668404579162598, 40 , 21,    2.0,1.0,2.0,    1.0,-0.0,-0.0,-0.0, launchpad_platform , cannon_material_normal );
        launchpad["cannonbody"].id = this.ID_LAUNCHPAD;
        
        /*P.119*/  
        launchpad = this.create_static_objects( 3.62, 40 , 19 ,    2.0,1.0,2.0,    1.0,-0.0,-0.0,-0.0, launchpad_platform , cannon_material_normal );
        launchpad["cannonbody"].id = this.ID_LAUNCHPAD;
        
        /*P.120*/  
        launchpad = this.create_static_objects( 7.59, 40 , 19,    2.0,1.0,2.0,    1.0,-0.0,-0.0,-0.0, launchpad_platform , cannon_material_normal );
        launchpad["cannonbody"].id = this.ID_LAUNCHPAD;


        /*P.121*/  
        launchpad = this.create_static_objects( 5.668404579162598, 55 , 25,    2.0,1.0,2.0,    1.0,-0.0,-0.0,-0.0, launchpad_platform , cannon_material_normal );
        launchpad["cannonbody"].id = this.ID_LAUNCHPAD;
        
        /*P.122*/  
        launchpad = this.create_static_objects( 3.62, 55 , 23 ,    2.0,1.0,2.0,    1.0,-0.0,-0.0,-0.0, launchpad_platform , cannon_material_normal );
        launchpad["cannonbody"].id = this.ID_LAUNCHPAD;
        
        /*P.123*/  
        launchpad = this.create_static_objects( 7.59, 55 , 23,    2.0,1.0,2.0,    1.0,-0.0,-0.0,-0.0, launchpad_platform , cannon_material_normal );
        launchpad["cannonbody"].id = this.ID_LAUNCHPAD;
        
        
        /*P.124*/  this.create_static_objects( 7.59, 65 , 23,   2.0,2.0, 2.0,    1.0,-0.0,-0.0,-0.0, green_platform , cannon_material_normal );
        /*P.125*/  this.create_static_objects( 20, 3.42, 8 ,    4.0, 0.2 ,1.0,    1.0,-0.0,-0.0,-0.0, green_platform , cannon_material_normal );


        this.common_box = common_box;
        this.common_sphere = common_sphere;
        
        

        //-----------------------
        // Main character ball
        let px = this.checkpoints[ this.cur_checkpoint_index ].x;
        let py = this.checkpoints[ this.cur_checkpoint_index ].y;
        let pz = this.checkpoints[ this.cur_checkpoint_index ].z;

        this.createPlayer( "self", px, py, pz , this.userData.displayName );
        



        //----------------------------
        // Generic crates
        let crate = new GLTFShape("models/crate.glb");
        let x = 14;
        let z = 8;
        let y = 5;
        let sx = 0.3;
        let sy = 0.3;
        let sz = 0.3;
        
        let cannon_box = new CANNON.Box( new CANNON.Vec3(sx/2,sy/2,sz/2) );
        let obj = this.create_dynamic_objects( x, y, z, sx,sy,sz, crate, cannon_box, 0.5 , cannon_material_low_fric, this.ID_CRATE );
        

        cannon_box = new CANNON.Box( new CANNON.Vec3(sx/2,sy/2,sz/2) );
        obj = this.create_dynamic_objects( x, y, z+sz, sx,sy,sz, crate, cannon_box, 0.5 , cannon_material_low_fric , this.ID_CRATE );
        

        x = -3.8;
        z = 14.5;
        y = 2.5;
        sx = 0.15;
        sy = 0.15;
        sz = 0.15;

        cannon_box = new CANNON.Box( new CANNON.Vec3(sx/2,sy/2,sz/2) );
        obj = this.create_dynamic_objects( x, y, z , sx,sy,sz, crate, cannon_box, 0.5 , cannon_material_low_fric, this.ID_CRATE );
        
        cannon_box = new CANNON.Box( new CANNON.Vec3(sx/2,sy/2,sz/2) );
        obj = this.create_dynamic_objects( x  , y, z - sz - 0.025 , sx,sy,sz, crate, cannon_box, 0.5 , cannon_material_low_fric, this.ID_CRATE );
        
        cannon_box = new CANNON.Box( new CANNON.Vec3(sx/2,sy/2,sz/2) );
        obj = this.create_dynamic_objects( x  , y, z + sz + 0.025, sx,sy,sz, crate, cannon_box, 0.5 , cannon_material_low_fric, this.ID_CRATE );
        
        cannon_box = new CANNON.Box( new CANNON.Vec3(sx/2,sy/2,sz/2) );
        obj = this.create_dynamic_objects( x  , y + sy    , z - sz  , sx,sy,sz, crate, cannon_box, 0.5 , cannon_material_low_fric, this.ID_CRATE );
        
        cannon_box = new CANNON.Box( new CANNON.Vec3(sx/2,sy/2,sz/2) );
        obj = this.create_dynamic_objects( x  , y + sy    , z + sz , sx,sy,sz, crate, cannon_box, 0.5 , cannon_material_low_fric, this.ID_CRATE );
        
        

       

        //--------------------
        // Swinging Pendulum
        /*P.117*/  
        let pendulum_hooks = [];
        let cannon_sphere;

        for ( let i = 0 ; i < 8 ; i++) {
            let ph = this.create_static_objects( 33 - i * 2  ,23.5,16.02290153503418,    0.20000000298023224,0.20000000298023224,0.20000000298023224,    1.0,-0.0,-0.0,-0.0, iron_platform , cannon_material_normal );
            pendulum_hooks.push( ph )
        }
        
        for ( let i = 0 ; i < pendulum_hooks.length - 1 ; i++ ) {

            x = 32 - i * 2;
            y = 21.63;
            z = 16.02;
            sx = 0.4;
            sy = 0.4;
            sz = 0.4;
            cannon_sphere = new CANNON.Sphere( sx / 2  );
            let pendulum_ball = this.create_dynamic_objects( x, y, z, sx,sy,sz, ironball, cannon_sphere, 1 , cannon_material_low_fric, this.ID_PENDULUM_BALL );

            pendulum_ball["phook0"] = pendulum_hooks[i];
            pendulum_ball["phook1"] = pendulum_hooks[i+1];
            
            let c:CANNON.DistanceConstraint ;
            c = new CANNON.DistanceConstraint(
                pendulum_hooks[i]["cannonbody"],
                pendulum_ball["cannonbody"],
                2.2
            );
            this.world.addConstraint(c);
            
            c = new CANNON.DistanceConstraint(
                pendulum_hooks[i+1]["cannonbody"],
                pendulum_ball["cannonbody"],
                2.2
            );
            this.world.addConstraint(c);
            this.cannon_pendulums.push( pendulum_ball );
            
            let force = ( i % 2 ) * 4 - 2 ;
            pendulum_ball["cannonbody"].applyImpulse(
                new CANNON.Vec3( 0, 0, force), 
                pendulum_ball["cannonbody"].position
            )
        }
        
        
        //-----------------------------
        /* Extra lives */
        let common_heart = new GLTFShape("models/heart.glb");
        
        x = 5.76;
        y = 13.625;
        z = 45.73
        cannon_sphere = new CANNON.Sphere( 0.1  );
        let extra_life = this.create_static_objects( x,y,z,    0.2,0.2,0.2,    1.0,-0.0,-0.0,-0.0, common_heart , cannon_material_normal , null, cannon_sphere );
        extra_life["cannonbody"].collisionResponse = 0;
        extra_life["cannonbody"].id = this.ID_EXTRALIFE;
        extra_life["ori_pos"] = new Vector3( x,y, z) ;
        this.cannon_pickables.push( extra_life );


        x = 2.64;
        y = 13.625;
        z = 48.68;
        cannon_sphere = new CANNON.Sphere( 0.1  );
        extra_life = this.create_static_objects( x,y,z,    0.2,0.2,0.2,    1.0,-0.0,-0.0,-0.0, common_heart , cannon_material_normal , null, cannon_sphere );
        extra_life["cannonbody"].collisionResponse = 0;
        extra_life["cannonbody"].id = this.ID_EXTRALIFE;
        extra_life["ori_pos"] = new Vector3( x,y, z) ;
        this.cannon_pickables.push( extra_life );


        x = 1.94;
        y = 13.625;
        z = 52.94;
        cannon_sphere = new CANNON.Sphere( 0.1  );
        extra_life = this.create_static_objects( x,y,z,    0.2,0.2,0.2,    1.0,-0.0,-0.0,-0.0, common_heart , cannon_material_normal , null, cannon_sphere );
        extra_life["cannonbody"].collisionResponse = 0;
        extra_life["cannonbody"].id = this.ID_EXTRALIFE;
        extra_life["ori_pos"] = new Vector3( x,y, z) ;
        this.cannon_pickables.push( extra_life );



        x = 20;
        y = 4.2;
        z = 8;
        cannon_sphere = new CANNON.Sphere( 0.1  );
        extra_life = this.create_static_objects( x,y,z,    0.2,0.2,0.2,    1.0,-0.0,-0.0,-0.0, common_heart , cannon_material_normal , null, cannon_sphere );
        extra_life["cannonbody"].collisionResponse = 0;
        extra_life["cannonbody"].id = this.ID_EXTRALIFE;
        extra_life["ori_pos"] = new Vector3( x,y, z) ;
        this.cannon_pickables.push( extra_life );
        

        x = -6;
        y = 4.5;
        z = 14.5;
        cannon_sphere = new CANNON.Sphere( 0.1  );
        extra_life = this.create_static_objects( x,y,z,    0.2,0.2,0.2,    1.0,-0.0,-0.0,-0.0, common_heart , cannon_material_normal , null, cannon_sphere );
        extra_life["cannonbody"].collisionResponse = 0;
        extra_life["cannonbody"].id = this.ID_EXTRALIFE;
        extra_life["ori_pos"] = new Vector3( x,y, z) ;
        this.cannon_pickables.push( extra_life );

        

        // Winning flag
        x = 7.59;
        y = 66.3;
        z = 23;
        let winning_flag = this.create_static_objects( x,y,z,    0.5,  0.5 ,0.02,    1.0,-0.0,-0.0,-0.0, checkerflag , cannon_material_normal );
        winning_flag["cannonbody"].collisionResponse = 0;
        winning_flag["cannonbody"].id = this.ID_WINNINGFLAG;
        winning_flag["ori_pos"] = new Vector3( x,y, z) ;
        this.cannon_pickables.push( winning_flag );


        // Highscore board 
        for ( let hcol = 0 ; hcol < 3 ; hcol++) {

            let lblhighscore = new Entity();
            lblhighscore.setParent(this );
            lblhighscore.addComponent( new TextShape("") );
            lblhighscore.addComponent( new Transform({
                position:new Vector3( 48,  33 , 50 - 15 * hcol),
                scale: new Vector3( 0.8, 0.8, 0.8)
            }) );
            lblhighscore.getComponent( Transform ).rotation.eulerAngles = new Vector3(0, 90,0);
            lblhighscore.getComponent( TextShape ).hTextAlign = "left";
            lblhighscore.getComponent( TextShape ).vTextAlign = "top";

            this.lblhighscore[hcol] = lblhighscore;
        }
        
        

        //-------
        // CameraBox
        x = 6.16;
        y = 4.35;
        z = 6.34;
        sx = sy = sz = 1;
        let camerabox = new Entity();
        camerabox.setParent(this);
        camerabox.addComponent( new Transform({
            position: new Vector3( x,y,z),
            scale: new Vector3(sx,sy,sz)
        }))

        camerabox.addComponent( new GLTFShape("models/camerafixture.glb") );
        camerabox.getComponent( GLTFShape ).isPointerBlocker = false;
        camerabox["is_camerabox"] = 1;

        this.camerabox = camerabox;
        

        



        //--------------
        this.createUI()
        this.init_cannon_eventhdls();
        
    }







    //----------
    init_materials() {


        // DCL obj materials
        let mat = new Material();
        mat.emissiveColor = Color3.Yellow();
        mat.emissiveIntensity = 4;
        this.materials.push( mat );

        mat = new Material();
        mat.albedoColor = Color4.Blue();
        this.materials.push( mat );

        mat = new Material();
        mat.albedoColor = Color4.FromInts(0,0,255, 128);
        this.materials.push( mat );

        mat = new Material();
        mat.albedoTexture = new Texture("images/life.png");
        mat.transparencyMode = 1;
        this.materials.push( mat);


        
        // Cannon physic materials
        let cannon_mat = new CANNON.Material("normal");
        cannon_mat.friction = 0.15;
        this.cannon_materials.push( cannon_mat );


        cannon_mat = new CANNON.Material("low_fric");
        cannon_mat.friction = 0.01;
        this.cannon_materials.push( cannon_mat );

        cannon_mat = new CANNON.Material("high_fric");
        cannon_mat.friction = 0.85;
        this.cannon_materials.push( cannon_mat );
        
    }



    //-------
    createPlayer(  sessionId , x ,y, z , username ) {
        
        
        let sx = 0.2;
        let sy = 0.2;
        let sz = 0.2;

        let cannon_material_normal   = this.cannon_materials[0];
        let spideyball  = new GLTFShape("models/spideyball.glb");
        let cannon_sphere = new CANNON.Sphere(sx/2);
        let mainobj     = this.create_dynamic_objects( x, y, z, sx,sy,sz, spideyball, cannon_sphere, 1, cannon_material_normal , this.ID_PLAYER );
        this.player_objects[ sessionId ] = mainobj;
        

        // grapple hook entity
        let grapple = new Entity();
        grapple.addComponent(new Transform({
            position: new Vector3(0,0,0),
            scale: new Vector3(1, 1, 1)
        }));
        grapple.setParent(this);
        mainobj["grapple"] = grapple;
        
        // grapple line entity
        let grapple_line = new Entity();
        grapple_line.addComponent( new Transform({
            position: new Vector3(0,0,0),
            scale: new Vector3(0.012, 0.012, 0.012)
        }))
        grapple_line.setParent( grapple );
        grapple_line.addComponent( this.common_box );
        grapple_line.addComponent( this.materials[0] );
        mainobj["grapple_line"] = grapple_line;

        // grapple head entity
        let grapple_head = new Entity();
        grapple_head.addComponent( new Transform({
            position: new Vector3(0,0,0),
            scale: new Vector3(0.05,0.05,0.05)
        }));
        grapple_head.setParent( grapple );
        grapple_head.addComponent( this.common_sphere );
        grapple_head.addComponent( this.materials[1] );
        mainobj["grapple_head"] = grapple_head;
        mainobj["grapple_state"] = 0;


        // grapple head cannon bodies 
        mainobj["grapple_cannonbody_dynamic"] = new CANNON.Body({
            mass: 0.15, // kg
            position: new CANNON.Vec3( 0,0,0 ), // m
            shape: new CANNON.Sphere(0.025)
        })
        mainobj["grapple_cannonbody_dynamic"].id = this.ID_GRAPPLE ;
        
        this.world.addBody( mainobj["grapple_cannonbody_dynamic"] );


        mainobj["grapple_cannonbody_static"] = new CANNON.Body({
            mass: 0, // kg
            position: new CANNON.Vec3( 0,0,0 ), // m
            shape: new CANNON.Box( new CANNON.Vec3( 0.025,0.025,0.025) )
        })
        this.world.addBody( mainobj["grapple_cannonbody_static"] );

        let nametag = new Entity();
        nametag.setParent( this );
        nametag.addComponent( new Transform({
            position: new Vector3(x,y + 0.02, z),
            scale: new Vector3(0.08,0.08,0.08)
        }))
        nametag.addComponent( new TextShape(username));
        nametag.addComponent( this.common_billboard );
        mainobj["nametag"] = nametag;



        return mainobj;

    }











    //--------
    init_sounds() {
        
        this.sounds["dropintowater"] = new AudioSource( new AudioClip("sounds/dropintowater.mp3") );
        let snd_ent = new Entity();
        snd_ent.setParent( this );
        snd_ent.addComponent( this.sounds["dropintowater"] );		

        this.sounds["crate"] = new AudioSource( new AudioClip("sounds/crate.mp3") );
        snd_ent = new Entity();
        snd_ent.setParent( this );
        snd_ent.addComponent( this.sounds["crate"] );		
        
        this.sounds["extralife"] = new AudioSource( new AudioClip("sounds/extralife.mp3") );
        snd_ent = new Entity();
        snd_ent.setParent( this );
        snd_ent.addComponent( this.sounds["extralife"] );	
        
        this.sounds["gameover"] = new AudioSource( new AudioClip("sounds/gameover.mp3") );
        snd_ent = new Entity();
        snd_ent.setParent( this );
        snd_ent.addComponent( this.sounds["gameover"] );	
        
        this.sounds["winning"] = new AudioSource( new AudioClip("sounds/winning.mp3") );
        snd_ent = new Entity();
        snd_ent.setParent( this );
        snd_ent.addComponent( this.sounds["winning"] );	

        this.sounds["checkpoint"] = new AudioSource( new AudioClip("sounds/checkpoint.mp3") );
        snd_ent = new Entity();
        snd_ent.setParent( this );
        snd_ent.addComponent( this.sounds["checkpoint"] );	
        
        

    }




    //-----
    static_obj_onclick( e ) {

        let ent = engine.entities[ e.hit.entityId ];
           
    }
    

    //------
    init_modarea(){

        const modArea = new Entity()
        

        modArea.addComponent(new CameraModeArea({
            area: { box: new Vector3( 64 ,640, 64) },
            cameraMode: CameraMode.FirstPerson,
        }));

        
        modArea.addComponent(new AvatarModifierArea({
            area: { box: new Vector3( 64 ,640,64) },
            modifiers: [AvatarModifiers.HIDE_AVATARS],
        }));
        

        modArea.addComponent(new Transform({
            position: new Vector3(32, 0, 32),
        }));

        engine.addEntity( modArea );

    }





    //--------
    init_inputs() {

        const input = Input.instance;




        // Left mouse
        input.subscribe("BUTTON_DOWN", ActionButton.POINTER, true, (e) => {
            if ( this.colyseus_room == null ) {
                this.fire_grapple();
            } else {
                this.colyseus_fire_grapple();
            }
        });
        input.subscribe("BUTTON_UP", ActionButton.POINTER, false, (e) => {
            if ( this.colyseus_room == null ) {
                this.release_grapple();
            } else {
                this.colyseus_room.send("release_grapple");
            }
        });






        // E
        input.subscribe("BUTTON_DOWN", ActionButton.PRIMARY, false, (e) => {
            
        });
        input.subscribe("BUTTON_UP", ActionButton.PRIMARY, false, (e) => {
           
        });





        // F
        input.subscribe("BUTTON_DOWN", ActionButton.SECONDARY, false, (e) => {
            
        });
        input.subscribe("BUTTON_UP", ActionButton.SECONDARY, false, (e) => {
            
        });







        // LEFT
        input.subscribe("BUTTON_DOWN", ActionButton.LEFT, false, (e) => {
            this.button_states[ActionButton.LEFT] = 1;
            this.button_states[ActionButton.RIGHT] = 0;  // unset opposite direction's down incase button up doesn't register.
            
        });
        input.subscribe("BUTTON_UP", ActionButton.LEFT, false, (e) => {
            this.button_states[ActionButton.LEFT] = 0;
        });

        // RIGHT
        input.subscribe("BUTTON_DOWN", ActionButton.RIGHT, false, (e) => {
            this.button_states[ActionButton.RIGHT] = 1;
            this.button_states[ActionButton.LEFT] = 0;  // unset opposite direction's down incase button up doesn't register.
        });
        input.subscribe("BUTTON_UP", ActionButton.RIGHT, false, (e) => {
            this.button_states[ActionButton.RIGHT] = 0;
        });

        // UP
        input.subscribe("BUTTON_DOWN", ActionButton.FORWARD, false, (e) => {
            this.button_states[ActionButton.FORWARD] = 1;
            this.button_states[ActionButton.BACKWARD] = 0;  // unset opposite direction's down incase button up doesn't register.
        });
        input.subscribe("BUTTON_UP", ActionButton.FORWARD, false, (e) => {
            this.button_states[ActionButton.FORWARD] = 0;
        });

        // DOWN
        input.subscribe("BUTTON_DOWN", ActionButton.BACKWARD, false, (e) => {
            this.button_states[ActionButton.BACKWARD] = 1;
            this.button_states[ActionButton.FORWARD] = 0;  // unset opposite direction's down incase button up doesn't register.
        });
        input.subscribe("BUTTON_UP", ActionButton.BACKWARD, false, (e) => {
            this.button_states[ActionButton.BACKWARD] = 0;
        });








        // JUMP
        input.subscribe("BUTTON_DOWN", ActionButton.JUMP, false, (e) => {
            if ( this.colyseus_room == null ) {
                if ( this.player_objects["self"]["grounded"] == 1 ) {
                    this.player_objects["self"]["cannonbody"].velocity.y = this.jump_velocity;

                }  else if ( this.player_objects["self"]["grapple_state"] == 1 ) {
                    this.player_objects["self"]["cannonbody"].applyImpulse(  
                        new CANNON.Vec3( 0 , 8 , 0 ), 
                        this.player_objects["self"]["cannonbody"].position
                    )
                } 
            } else {
                this.colyseus_room.send("jump");
            }
        });
        input.subscribe("BUTTON_UP", ActionButton.JUMP, false, (e) => {
            
        });


        // Num 1
        input.subscribe("BUTTON_DOWN", ActionButton.ACTION_3, false, (e) => {
            if ( this.colyseus_room == null ) {
                ui.displayAnnouncement("Game Restarted.", 10, Color4.Yellow(), 14, false);
                this.respawn_at_startingpoint(); 
            } else {
                this.colyseus_room.send("restart");
            }
        });

        input.subscribe("BUTTON_UP", ActionButton.ACTION_3, false, (e) => {
            
        });


        // Num 2
        input.subscribe("BUTTON_DOWN", ActionButton.ACTION_4, false, (e) => {
            
            if ( this.colyseus_room == null ) {
                
                this.init_colyseus();
            } else {
                
                ui.displayAnnouncement("Back to Single Player. ", 10, Color4.Yellow(), 14, false);
                this.colyseus_room.leave();
                
            }
            

        });
        input.subscribe("BUTTON_UP", ActionButton.ACTION_4, false, (e) => {
            
        });
        


        
    }


    //-----------
    respawn_at_startingpoint() {

        this.sounds["gameover"].playOnce();

        this.cur_checkpoint_index = 0;
        this.respawn_at_checkpoint(); 

        this.game_completed = 0;

        this.lives = 5;
        this.ui_lives.value = "Lives: " + this.lives;

        this.time = 0;
        this.ui_time.value = "Time: " + this.format_time( this.time );

        // also need to restore all extralife balls;
        for ( let i = 1 ; i < this.cannon_pickables.length ; i++ ) {
            this.cannon_pickables[i]["cannonbody"].position.y = this.cannon_pickables[i]["ori_pos"].y;
        }

    }

    //-------------------
    respawn_at_checkpoint() {
        

        if ( this.player_objects["self"]["grapple_state"] == 1 ) {
            this.release_grapple();
        }

        this.clear_button_states();
        
        this.reset_cannonbody(this.player_objects["self"]["cannonbody"]);
        this.player_objects["self"]["cannonbody"].position.x = this.checkpoints[this.cur_checkpoint_index].x;
        this.player_objects["self"]["cannonbody"].position.y = this.checkpoints[this.cur_checkpoint_index].y;
        this.player_objects["self"]["cannonbody"].position.z = this.checkpoints[this.cur_checkpoint_index].z;  
        
        for ( let i = 0 ; i < this.cannon_dynamics.length ; i++ ) {
        
            this.reset_cannonbody(this.cannon_dynamics[i]["cannonbody"]);
            this.cannon_dynamics[i]["cannonbody"].position.x = this.cannon_dynamics[i]["ori_pos"].x;
            this.cannon_dynamics[i]["cannonbody"].position.y = this.cannon_dynamics[i]["ori_pos"].y;
            this.cannon_dynamics[i]["cannonbody"].position.z = this.cannon_dynamics[i]["ori_pos"].z;    
        }
        
    }



    //--------------------------
    format_time( tick ) {
        
        let remaining = tick ;

        let hours   = ( remaining / 108000 ) >> 0;
        remaining = remaining % 108000;

        let minutes = ( remaining / 1800 ) >> 0;
        remaining = tick % 1800;
        
        let seconds = ( remaining / 30 ) >> 0;
        remaining = remaining % 30;

        let strhour     = ("0" + hours).slice(-2);
        let strminutes  = ("0" + minutes).slice(-2);
        let strseconds  = ("0" + seconds).slice(-2);
        
        return strhour + ":" + strminutes + ":" + strseconds ;


    }


    //-----------
    move_main_char( direction ) {

        
        let use_force = this.move_force;
        if ( this.player_objects["self"]["grapple_state"] == 1) {
            use_force = this.move_force * 0.4;
        }

        let cannonbody:CANNON.Body = this.player_objects["self"]["cannonbody"];
        if ( direction == 0 ) {
            let left = Vector3.Left().rotate( Camera.instance.rotation);
            cannonbody.applyForce( new CANNON.Vec3( left.x * use_force , 0, left.z * use_force ), cannonbody.position);

        } else if ( direction == 2  ) {
            let right = Vector3.Right().rotate( Camera.instance.rotation);
            cannonbody.applyForce( new CANNON.Vec3( right.x * use_force , 0, right.z * use_force ), cannonbody.position);
        }

        if ( direction == 1 ) {
            let forward = Vector3.Forward().rotate(Camera.instance.rotation)
            cannonbody.applyForce( new CANNON.Vec3( forward.x * use_force , 0, forward.z * use_force ), cannonbody.position);
        } else if ( direction == 3  ) {
            let backward = Vector3.Backward().rotate(Camera.instance.rotation)
            cannonbody.applyForce( new CANNON.Vec3( backward.x * use_force , 0, backward.z * use_force ), cannonbody.position);
        }                
    }


    //---------
    colyseus_move_main_char( direction ) {

        let use_force = this.move_force;
        if ( this.player_objects["self"]["grapple_state"] == 1) {
            use_force = this.move_force * 0.4;
        }

        if ( direction == 0 ) {
            let left = Vector3.Left().rotate( Camera.instance.rotation);
            this.colyseus_room.send( "applyforce", [ left.x * use_force , 0, left.z * use_force ] )

        } else if ( direction == 2  ) {
            let right = Vector3.Right().rotate( Camera.instance.rotation);
            this.colyseus_room.send( "applyforce", [ right.x * use_force , 0, right.z * use_force ] )

        }

        if ( direction == 1 ) {
            let forward = Vector3.Forward().rotate(Camera.instance.rotation)
            this.colyseus_room.send( "applyforce", [ forward.x * use_force , 0, forward.z * use_force ] )

        } else if ( direction == 3  ) {
            let backward = Vector3.Backward().rotate(Camera.instance.rotation)
            this.colyseus_room.send( "applyforce", [ backward.x * use_force , 0, backward.z * use_force ] )
        }                   
    }


    
    //---------
    colyseus_fire_grapple() {
        
        let throw_power = 1;
        let use_vector = new Vector3(0,0,0);
        if ( this.button_states[ActionButton.LEFT] == 1) {
            use_vector = Vector3.Left();
        } else if ( this.button_states[ActionButton.RIGHT] == 1) {
            use_vector = Vector3.Right();
        } else if ( this.button_states[ActionButton.FORWARD] == 1 ) {
            use_vector = Vector3.Forward();
        } else if ( this.button_states[ActionButton.BACKWARD] == 1) {
            use_vector = Vector3.Backward();
        }
        let direction_vec = use_vector.rotate(Camera.instance.rotation);
        this.colyseus_room.send( "fire_grapple", [ direction_vec.x * throw_power , 1.4 * throw_power, direction_vec.z * throw_power ] )
    }
    
    
    //---------
    fire_grapple() {
        
        this.release_grapple();
        let throw_power = 1;
        
        let use_vector = new Vector3(0,0,0);

        if ( this.button_states[ActionButton.LEFT] == 1) {
            use_vector = Vector3.Left();
        } else if ( this.button_states[ActionButton.RIGHT] == 1) {
            use_vector = Vector3.Right();
        } else if ( this.button_states[ActionButton.FORWARD] == 1 ) {
            use_vector = Vector3.Forward();
        } else if ( this.button_states[ActionButton.BACKWARD] == 1) {
            use_vector = Vector3.Backward();
        }
        
        let direction_vec = use_vector.rotate(Camera.instance.rotation);
        this.player_objects["self"]["grapple_state"] = 2;

        this.reset_cannonbody( this.player_objects["self"]["grapple_cannonbody_dynamic"] );

        this.player_objects["self"]["grapple_cannonbody_dynamic"].position.set( 
            this.player_objects["self"]["cannonbody"].position.x, 
            this.player_objects["self"]["cannonbody"].position.y + 0.2, 
            this.player_objects["self"]["cannonbody"].position.z
        );

        this.player_objects["self"]["grapple_cannonbody_dynamic"].applyImpulse(  
            new CANNON.Vec3( direction_vec.x * throw_power , 1.4 * throw_power, direction_vec.z * throw_power ), 
            this.player_objects["self"]["grapple_cannonbody_dynamic"].position
        )
        
    }   

    //------
    release_grapple() {
        
        this.player_objects["self"]["grapple_state"] = 0;
        if ( this.player_objects["self"]["constraint"] != null ) {
            this.world.removeConstraint( this.player_objects["self"]["constraint"] );
            this.player_objects["self"]["constraint"] = null;
        }
    }

     //----
     create_constraint() {
        
        let distance = this.player_objects["self"]["cannonbody"].position.distanceTo( this.player_objects["self"]["grapple_cannonbody_static"].position );
        let c:CANNON.DistanceConstraint = new CANNON.DistanceConstraint(
            this.player_objects["self"]["grapple_cannonbody_static"],
            this.player_objects["self"]["cannonbody"],
            distance,
            2
        );
        
        this.player_objects["self"]["constraint"] = c;
        
        this.world.addConstraint(c);
    }


    //-------------
    add_life( amt ) {
        
        ui.displayAnnouncement("Extra life +1", 5, Color4.Green(), 14 , false );
        this.lives += amt;
        this.ui_lives.value = "Lives: " + this.lives;
        this.sounds["extralife"].playOnce();

    }

    //--------
    reduce_life(amt) {

        this.lives -= amt;
        this.ui_lives.value = "Lives: " + this.lives;
        
    }

    //---------------
    win_game() {
        
        ui.displayAnnouncement("Congratulations! You have won. You can restart by pressing 1.", 5, Color4.Green(), 14 , false );
        this.sounds["winning"].playOnce();
        this.game_completed = 1;
        this.update_highscore();
        
        
    }
    

    //-------
    reset_cannonbody( body:CANNON.Body ) {

        // Position
        body.position.setZero();
        body.previousPosition.setZero();
        body.interpolatedPosition.setZero();
        body.initPosition.setZero();

        // orientation
        body.quaternion.set(0,0,0,1);
        body.initQuaternion.set(0,0,0,1);
        body.interpolatedQuaternion.set(0,0,0,1);

        // Velocity
        body.velocity.setZero();
        body.initVelocity.setZero();
        body.angularVelocity.setZero();
        body.initAngularVelocity.setZero();

        // Force
        body.force.setZero();
        body.torque.setZero();

        // Sleep state reset
        body.sleepState = 0;
        body.timeLastSleepy = 0;
    
    }

    //----------------------
    clear_button_states() {
        this.button_states[ActionButton.LEFT]       = 0;
        this.button_states[ActionButton.FORWARD]    = 0;
        this.button_states[ActionButton.RIGHT]      = 0;
        this.button_states[ActionButton.BACKWARD]   = 0;     
        
    }

    //---------
    clear_other_players() {
        for ( let sessionId in this.player_objects ) {
            if ( sessionId != "self") {
                this.remove_player_by_sessionId( sessionId );
            }   
        }
    }


    //------------------
    remove_player_by_sessionId( sessionId ) {
        
        // Remove all cannon bodies related to this player.
        this.world.remove( this.player_objects[ sessionId ]["cannonbody"] );
        this.world.remove( this.player_objects[ sessionId ]["grapple_cannonbody_dynamic"] );
        this.world.remove( this.player_objects[ sessionId ]["grapple_cannonbody_static"] );
        
        // Next remove all entities related to this player.
        engine.removeEntity(  this.player_objects[ sessionId ]["grapple"] );
        engine.removeEntity(  this.player_objects[ sessionId ]["grapple_line"] );
        engine.removeEntity(  this.player_objects[ sessionId ]["grapple_head"] );
        engine.removeEntity(  this.player_objects[ sessionId ]["nametag"] );
        engine.removeEntity(  this.player_objects[ sessionId ] );

        
        // Finally delete the map
        delete this.player_objects[ sessionId ];
        
    }

    //-------------------
    async init_colyseus() {

        let _this = this;
        
        let protocol    = "wss";
        let host        = "tensaistudio.xyz:444";
        
        const playerRealm = await getCurrentRealm()
        if ( playerRealm.serverName == "localhost" ) {
            protocol    = "ws";
            host        = "localhost:2567"
        }
        
        var client  = new Client( protocol + "://" + host );
        

        if (!this.userData) {
            await this.setUserData()
        }	
        

        client.joinOrCreate( "ballparkour" , 
            {   
                username : this.userData.displayName , 
                user_addr: this.userData.userId ,
            } 
        ).then(room => {
                
            
            _this.colyseus_room = room;
            _this.time = 0;
            _this.game_completed = 0;

            ui.displayAnnouncement("Joining Multiplayer Server.... \nServer Connected. \n\n Note: You may experience slight latency as physics simulation is done on server in multiplayers mode.", 10, Color4.Yellow(), 14, false);
            
            _this.ui_mode.value = "Mode: Multiplayers. "
            _this.ui_mode.color = Color3.Green();

            
            //----------------------
            room.onLeave(code => {
                if (code > 1000) {
                    log("room.onLeave", "Abnormal closation")
                } else {
                    // the client has initiated the disconnection
                    log("room.onLeave", "Normal closation")
                }
                ui.displayAnnouncement("Server disconnected. Back to single player mode.", 10, Color4.Blue(), 14 , false );
                _this.clear_other_players();
                _this.colyseus_room = null;
                _this.ui_mode.value = "Mode: Single Player "
                _this.ui_mode.color = Color3.White();

            });



            //----------------------
            room.onError((code, message) => {
                log("room.onError","Error occured on serverside.")
            });



            //----------------------
            room.state.players.onAdd = function ( player, sessionId) {

                log("room.state.players.onAdd", sessionId , player.displayName , player.user_addr );
                
                if ( player.sessionId != room.sessionId ) {
                    // Other players
                    let mainplayer = _this.createPlayer( player.sessionId, player.x, player.y, player.z , player.displayName );
                    ui.displayAnnouncement("[SERVER] Player " + player.displayName  + " has joined the game.", 5, Color4.Blue(), 14, false);
                }   

                player.onChange = function (changes) {
                    
                    let use_sessionId = player.sessionId;
                    if ( player.sessionId == room.sessionId ) {
                        use_sessionId = "self";
                    }

                    
                    _this.player_objects[use_sessionId]["cannonbody"].position.x = player.x ;
                    _this.player_objects[use_sessionId]["cannonbody"].position.y = player.y ;
                    _this.player_objects[use_sessionId]["cannonbody"].position.z = player.z ;
                    
                    _this.player_objects[use_sessionId]["cannonbody"].quaternion.w = player.qw ;
                    _this.player_objects[use_sessionId]["cannonbody"].quaternion.x = player.qx ;
                    _this.player_objects[use_sessionId]["cannonbody"].quaternion.y = player.qy ;
                    _this.player_objects[use_sessionId]["cannonbody"].quaternion.z = player.qz ;

                    
                    _this.player_objects[use_sessionId].grapple_state = player.grapple_state ;
                    if ( player.grapple_state == 2 ) {
                        _this.player_objects[use_sessionId]["grapple_cannonbody_dynamic"].position.x = player.gx ;
                        _this.player_objects[use_sessionId]["grapple_cannonbody_dynamic"].position.y = player.gy ;
                        _this.player_objects[use_sessionId]["grapple_cannonbody_dynamic"].position.z = player.gz ;
                    } else if ( player.grapple_state == 1 ) {
                        _this.player_objects[use_sessionId]["grapple_cannonbody_static"].position.x = player.gx ;
                        _this.player_objects[use_sessionId]["grapple_cannonbody_static"].position.y = player.gy ;
                        _this.player_objects[use_sessionId]["grapple_cannonbody_static"].position.z = player.gz ;
                    }


                }
            }


            //----------------------
            room.state.cannon_dynamic_objects.onAdd = function ( cannon_dynamic_object, sessionId) {

                log("room.state.cannon_dynamic_objects.onAdd", sessionId  );
                
                cannon_dynamic_object.onChange = function (changes) {

                    //log("cannon_dynamic_object onChange", changes );
                    let id = cannon_dynamic_object.id;
                    _this.cannon_dynamics[id]["cannonbody"].position.x = cannon_dynamic_object.x;
                    _this.cannon_dynamics[id]["cannonbody"].position.y = cannon_dynamic_object.y;
                    _this.cannon_dynamics[id]["cannonbody"].position.z = cannon_dynamic_object.z;
                    _this.cannon_dynamics[id]["cannonbody"].quaternion.w = cannon_dynamic_object.qw;
                    _this.cannon_dynamics[id]["cannonbody"].quaternion.x = cannon_dynamic_object.qx;
                    _this.cannon_dynamics[id]["cannonbody"].quaternion.y = cannon_dynamic_object.qy;
                    _this.cannon_dynamics[id]["cannonbody"].quaternion.z = cannon_dynamic_object.qz;
                
                }
                
            }


            //----------------------
            room.state.cannon_movable_statics.onAdd = function ( cannon_static_object, sessionId) {

                log("room.state.cannon_movable_statics.onAdd", sessionId  );
                
                cannon_static_object.onChange = function (changes) {

                    let id = cannon_static_object.id;
                    _this.cannon_movable_statics[id]["cannonbody"].position.x = cannon_static_object.x;
                    _this.cannon_movable_statics[id]["cannonbody"].position.y = cannon_static_object.y;
                    _this.cannon_movable_statics[id]["cannonbody"].position.z = cannon_static_object.z;
                    _this.cannon_movable_statics[id]["cannonbody"].quaternion.w = cannon_static_object.qw;
                    _this.cannon_movable_statics[id]["cannonbody"].quaternion.x = cannon_static_object.qx;
                    _this.cannon_movable_statics[id]["cannonbody"].quaternion.y = cannon_static_object.qy;
                    _this.cannon_movable_statics[id]["cannonbody"].quaternion.z = cannon_static_object.qz;
                
                }
                
            }


            //----------------------
            room.state.cannon_pickable_objects.onAdd = function ( cannon_pickable_object, sessionId) {

                log("room.state.cannon_pickable_objects.onAdd", sessionId  );
                
                cannon_pickable_object.onChange = function (changes) {

                    log("cannon_pickable_object onChange", changes );
                    let id = cannon_pickable_object.id;
                    _this.cannon_pickables[id]["cannonbody"].position.x = cannon_pickable_object.x;
                    _this.cannon_pickables[id]["cannonbody"].position.y = cannon_pickable_object.y;
                    _this.cannon_pickables[id]["cannonbody"].position.z = cannon_pickable_object.z;
                }
            }

            

            //----------------------
            room.state.players.onRemove = function (player, sessionId) {

                ui.displayAnnouncement("[SERVER] Player " + player.displayName  + " has left the game.", 5, Color4.Blue(), 14, false);
                log("room.state.players.onRemove", player.sessionId );
                _this.remove_player_by_sessionId( player.sessionId );

            }



            //----------------------
            room.onMessage("died", ( player_lives_on_server ) => {
                
                ui.displayAnnouncement("[SERVER] You died. Ball respawned at last check point", 5, Color4.Blue(), 14, false);
                
                _this.sounds["dropintowater"].playOnce();
                _this.reset_cannonbody( _this.player_objects["self"].cannonbody );
                _this.lives = player_lives_on_server;
                _this.reduce_life( 0 );

            });

            //----------------------
            room.onMessage("gameover", ( msg_args ) => {
                
                ui.displayAnnouncement("[SERVER] Game Over. Restart from starting point again.", 10, Color4.Blue(), 14, false);
                _this.sounds["gameover"].playOnce();
                _this.reset_cannonbody( _this.player_objects["self"].cannonbody );
                _this.lives = 5;
                _this.time = 0;
                _this.reduce_life( 0 );

            });

            //----------------------
            room.onMessage("add_life", ( player_lives_on_server ) => {
                _this.lives = player_lives_on_server;
                _this.add_life(0);
            });

            //----------------------
            room.onMessage("win_game", ( player_lives_on_server ) => {
                _this.win_game();
            });

            //---------
            room.onMessage("restart", ( player_lives_on_server ) => {
                ui.displayAnnouncement("[SERVER] Player Restarted.", 10, Color4.Blue(), 14, false);
                _this.reset_cannonbody( _this.player_objects["self"].cannonbody );
                _this.lives = 5;
                _this.time = 0;
                _this.game_completed = 0;
                _this.reduce_life( 0 );
            });

            //---------
            room.onMessage("checkpoint", ( ) => {
                ui.displayAnnouncement("[SERVER] Checkpoint Reached.", 10, Color4.Blue(), 14, false);
                _this.ui_msg.value = _this.instruction_A + "\n" + _this.instruction_B;
            });


                
        }).catch(e => {
            
            ui.displayAnnouncement("Unable to connect to Colyseus Server. ", 10, Color4.Red(), 14, false);
            
            log("CONNECT ERROR", e);
        });
    }

   







    //-------------------------------
    single_player_update( dt ) {

        this.world.step( this.FIXED_TIME_STEPS, dt, this.MAX_TIME_STEPS)
        
        if ( this.player_objects["self"]["cannonbody"].position.y < 0 ) {
            this.sounds["dropintowater"].playOnce();
            this.reduce_life( 1 );
            if ( this.lives >= 1 ) {
                ui.displayAnnouncement("You died. Ball respawned at last check point", 5, Color4.Yellow(), 14, false);
                this.respawn_at_checkpoint();
            } else { 
                ui.displayAnnouncement("Game Over. Restart from starting point again.", 10, Color4.Yellow(), 14, false);
                this.respawn_at_startingpoint();
            }
        }
        

        
        
        // grapple stuffs
        if ( this.player_objects["self"]["grapple_state"] > 0  ) { 
            
            if ( this.player_objects["self"]["grapple_state"] == 2 ) {
                // State 2 : Grapple is still flying.
                this.player_objects["self"]["grapple"].getComponent( Transform ).position.copyFrom( this.player_objects["self"]["grapple_cannonbody_dynamic"].position );
            } else {
                // State 1 : Grapple is hooked
                this.player_objects["self"]["grapple"].getComponent( Transform ).position.copyFrom( this.player_objects["self"]["grapple_cannonbody_static"].position );
                
            }
            let vec = this.player_objects["self"].getComponent(Transform).position.subtract(   this.player_objects["self"]["grapple"].getComponent( Transform ).position );
            let quaternion = Quaternion.LookRotation( vec );
            this.player_objects["self"]["grapple"].getComponent( Transform ).rotation = quaternion;
            
            let magnitude = Vector3.Distance(  this.player_objects["self"]["grapple"].getComponent( Transform ).position , this.player_objects["self"].getComponent(Transform).position )
            
            this.player_objects["self"]["grapple_line"].getComponent( Transform ).scale.z        = magnitude;
            this.player_objects["self"]["grapple_line"].getComponent( Transform ).position.z     = magnitude / 2;

            
            if (  this.player_objects["self"]["grapple_state"] == 2 ) {
                // State 2 :grapple is still flying.
                if ( magnitude > this.grapple_max_length ) {
                    this.player_objects["self"]["grapple_state"] = 0;
                } 
                
            } else if (  this.player_objects["self"]["grapple_state"] == 1 ) {
                // State 1 : grapple is hooked.. now slowly contracting the length
                if (  this.player_objects["self"]["constraint"].distance > this.grapple_min_length ) {
                    
                    this.player_objects["self"]["constraint"].distance -= 0.035;
                }

            }

        } else {            
            this.player_objects["self"]["grapple"].getComponent( Transform ).position.y = -500;
            this.player_objects["self"]["grapple_line"].getComponent( Transform ).scale.z = 0.001;
        }


        // Rotating platform
        for ( let i = 0 ; i < 4 ; i += 2) {
            let ry = this.cannon_movable_statics[i]["ry"];
            this.cannon_movable_statics[i]["cannonbody"].quaternion.setFromEuler( 0 , 0 , ry );
            this.cannon_movable_statics[i].getComponent(Transform).rotation.copyFrom( this.cannon_movable_statics[i]["cannonbody"].quaternion);
            this.cannon_movable_statics[i]["ry"] += 0.01 ;
            if ( this.cannon_movable_statics[i]["ry"] > 180 ) {
                this.cannon_movable_statics[i]["ry"] = -180;
            }
        }

        for ( let i = 1 ; i < 4 ; i += 2) {
            let ry = this.cannon_movable_statics[i]["ry"];
            this.cannon_movable_statics[i]["cannonbody"].quaternion.setFromEuler( 0 , 0 , ry );
            this.cannon_movable_statics[i].getComponent(Transform).rotation.copyFrom( this.cannon_movable_statics[i]["cannonbody"].quaternion);
            this.cannon_movable_statics[i]["ry"] -= 0.01 ;
            if ( this.cannon_movable_statics[i]["ry"] < -180 ) {
                this.cannon_movable_statics[i]["ry"] = 180;
            }
        }

        
        // Pendulum auto swing
        for ( let i = 0 ; i < this.cannon_pendulums.length ; i++ ) {
            let cb:CANNON.Body = this.cannon_pendulums[i]["cannonbody"];
            if ( cb.velocity.z * cb.velocity.z < 0.01 ) {

                let force = Math.random();
                if ( cb.position.z > this.cannon_pendulums[i]["phook0"]["cannonbody"].position.z ) {
                    force = Math.random() * -1;
                }
                this.cannon_pendulums[i]["cannonbody"].applyImpulse(
                    new CANNON.Vec3( 0, 0, force), 
                    this.cannon_pendulums[i]["cannonbody"].position
                )

            }
        }
        



        // Checkpoint register 
        if ( 
            this.cur_checkpoint_index < this.checkpoints.length - 1 &&
            Vector3.DistanceSquared( this.player_objects["self"].getComponent(Transform).position, this.checkpoints[this.cur_checkpoint_index + 1 ] ) < 0.1 ) {
            
            ui.displayAnnouncement("New Checkpoint Reached!", 5, Color4.Yellow(), 14, false);
            this.cur_checkpoint_index += 1;

            this.sounds["checkpoint"].playOnce();


            if ( this.cur_checkpoint_index == 1 ) {
                this.ui_msg.value = this.instruction_A + "\n" + this.instruction_B
                
            }

        }


        // Moving players
        if ( this.button_states[ActionButton.LEFT] == 1) {
            this.move_main_char(0);
        } else if ( this.button_states[ActionButton.RIGHT] == 1) {
            this.move_main_char(2);
        } else if ( this.button_states[ActionButton.FORWARD] == 1 ) {
            this.move_main_char(1);
        } else if ( this.button_states[ActionButton.BACKWARD] == 1) {
            this.move_main_char(3);
        }
        
        
        
    }




    //--------------------------------------------------
    multiplayers_update( dt ) {
        
        // Movable statics
        for ( let i = 0 ; i < this.cannon_movable_statics.length ; i++ ) {
            this.cannon_movable_statics[i].getComponent(Transform).position.x = this.cannon_movable_statics[i]["cannonbody"].position.x;
            this.cannon_movable_statics[i].getComponent(Transform).position.y = this.cannon_movable_statics[i]["cannonbody"].position.y;
            this.cannon_movable_statics[i].getComponent(Transform).position.z = this.cannon_movable_statics[i]["cannonbody"].position.z;
            this.cannon_movable_statics[i].getComponent(Transform).rotation.copyFrom( this.cannon_movable_statics[i]["cannonbody"].quaternion);
        }

        // Moving players
        if ( this.button_states[ActionButton.LEFT] == 1) {
            this.colyseus_move_main_char(0);
        } else if ( this.button_states[ActionButton.RIGHT] == 1) {
            this.colyseus_move_main_char(2);
        } else if ( this.button_states[ActionButton.FORWARD] == 1 ) {
            this.colyseus_move_main_char(1);
        } else if ( this.button_states[ActionButton.BACKWARD] == 1) {
            this.colyseus_move_main_char(3);
        }

        // grapple stuffs 
        for ( let sessionId in this.player_objects ) {
            if ( this.player_objects[sessionId]["grapple_state"] > 0  ) { 
                
                if ( this.player_objects[sessionId]["grapple_state"] == 2 ) {
                    // State 2 : Grapple is still flying.
                    this.player_objects[sessionId]["grapple"].getComponent( Transform ).position.copyFrom( this.player_objects[sessionId]["grapple_cannonbody_dynamic"].position );
                } else {
                    // State 1 : Grapple is hooked
                    this.player_objects[sessionId]["grapple"].getComponent( Transform ).position.copyFrom( this.player_objects[sessionId]["grapple_cannonbody_static"].position );
                    
                }
                let vec = this.player_objects[sessionId].getComponent(Transform).position.subtract(   this.player_objects[sessionId]["grapple"].getComponent( Transform ).position );
                let quaternion = Quaternion.LookRotation( vec );
                this.player_objects[sessionId]["grapple"].getComponent( Transform ).rotation = quaternion;
                
                let magnitude = Vector3.Distance(  this.player_objects[sessionId]["grapple"].getComponent( Transform ).position , this.player_objects[sessionId].getComponent(Transform).position )
            

                this.player_objects[sessionId]["grapple_line"].getComponent( Transform ).scale.z        = magnitude;
                this.player_objects[sessionId]["grapple_line"].getComponent( Transform ).position.z     = magnitude / 2;                

            } else {            
                this.player_objects[sessionId]["grapple"].getComponent( Transform ).position.y = -500;
                this.player_objects[sessionId]["grapple_line"].getComponent( Transform ).scale.z = 0.001;
            }
        }
    }









    //-----------
    update( dt ) {

        

        if ( this.colyseus_room == null ) {
            this.single_player_update( dt );
        } else {
            this.multiplayers_update( dt );
        }

        // Update players position to match cannonbodies
        for ( let sessionId in this.player_objects ) {

            this.player_objects[sessionId].getComponent(Transform).position.x = this.player_objects[sessionId]["cannonbody"].position.x;
            this.player_objects[sessionId].getComponent(Transform).position.y = this.player_objects[sessionId]["cannonbody"].position.y;
            this.player_objects[sessionId].getComponent(Transform).position.z = this.player_objects[sessionId]["cannonbody"].position.z;
            this.player_objects[sessionId].getComponent(Transform).rotation.copyFrom( this.player_objects[sessionId]["cannonbody"].quaternion);

            this.player_objects[sessionId]["nametag"].getComponent(Transform).position.x = this.player_objects[sessionId].getComponent(Transform).position.x;
            this.player_objects[sessionId]["nametag"].getComponent(Transform).position.y = this.player_objects[sessionId].getComponent(Transform).position.y + 0.2;
            this.player_objects[sessionId]["nametag"].getComponent(Transform).position.z = this.player_objects[sessionId].getComponent(Transform).position.z ;
            

        }
        
        // Update objects position to match cannonbodies
        for ( let i = 0 ; i < this.cannon_dynamics.length ; i++ ) {
            this.cannon_dynamics[i].getComponent(Transform).position.x = this.cannon_dynamics[i]["cannonbody"].position.x;
            this.cannon_dynamics[i].getComponent(Transform).position.y = this.cannon_dynamics[i]["cannonbody"].position.y;
            this.cannon_dynamics[i].getComponent(Transform).position.z = this.cannon_dynamics[i]["cannonbody"].position.z;
            this.cannon_dynamics[i].getComponent(Transform).rotation.copyFrom( this.cannon_dynamics[i]["cannonbody"].quaternion);
        }

        

        // Update pickables to match cannonbodies
        for ( let i = 0 ; i < this.cannon_pickables.length; i++ ) {
            this.cannon_pickables[i].getComponent(Transform).position.x = this.cannon_pickables[i]["cannonbody"].position.x;
            this.cannon_pickables[i].getComponent(Transform).position.y = this.cannon_pickables[i]["cannonbody"].position.y;
            this.cannon_pickables[i].getComponent(Transform).position.z = this.cannon_pickables[i]["cannonbody"].position.z;
        }



        // Update time
        if ( this.game_completed == 0 ) {
            this.time += 1;
            this.ui_time.value = "Time: " + this.format_time( this.time );
        }





        
        // Trap the player inside camera fixture collider.
        let xdiff = this.camerabox.getComponent(Transform).position.x - (Camera.instance.feetPosition.x - this.getComponent(Transform).position.x );
        let ydiff = this.camerabox.getComponent(Transform).position.y - (Camera.instance.feetPosition.y - this.getComponent(Transform).position.y ) + 0.2 ;
        let zdiff = this.camerabox.getComponent(Transform).position.z - (Camera.instance.feetPosition.z - this.getComponent(Transform).position.z );
        
        if ( xdiff * xdiff + ydiff * ydiff + zdiff * zdiff > 0.5 * 0.5 * 0.5) {

            log("Player trapped.");

            let to_x = this.camerabox.getComponent(Transform).position.x        + this.getComponent(Transform).position.x; 
            let to_y = this.camerabox.getComponent(Transform).position.y + 0.2  + this.getComponent(Transform).position.y;
            let to_z = this.camerabox.getComponent(Transform).position.z        + this.getComponent(Transform).position.z;

            // Prevent the camerabox from going into restricted coordinates where movePlayerTo cannot work.
            if ( to_x <= 0 || to_x >= 64 ) {
                this.camerabox.getComponent(Transform).position.x = 8;
                to_x = this.camerabox.getComponent(Transform).position.x        + this.getComponent(Transform).position.x; 
            }
            if ( to_y <= 0  ) {
                this.camerabox.getComponent(Transform).position.y = 4.5;
                to_y = this.camerabox.getComponent(Transform).position.y        + this.getComponent(Transform).position.y; 
            }
            if ( to_z <= 0 || to_z >= 64 ) {
                this.camerabox.getComponent(Transform).position.z = 8;
                to_z = this.camerabox.getComponent(Transform).position.z        + this.getComponent(Transform).position.z;
            }
            // Move player into the camerabox.
            movePlayerTo({
                x: to_x, 
                y: to_y, 
                z: to_z
            });

        } else {
            
            // Move the camerabox according to ball position
            if ( this.player_objects["self"]["cannonbody"].position.y > 0  ) {
    
                let bw = Vector3.Backward().rotate(Camera.instance.rotation)
                
                let x =  this.player_objects["self"].getComponent(Transform).position.x  +  bw.x * 3;
                let y =  this.player_objects["self"].getComponent(Transform).position.y  +  0.2 ;
                let z =  this.player_objects["self"].getComponent(Transform).position.z  +  bw.z * 3;
                
                if ( this.player_objects["self"]["grapple_state"] == 1 ) {
                    y -= 1;
                }   

                let endtarget = new Vector3(x,y,z);
                let lerp_amt = 0.1;
                
                this.camerabox.getComponent(Transform).position = Vector3.Lerp( 
                    this.camerabox.getComponent(Transform).position,
                    endtarget,
                    lerp_amt
                );
            } 
        }
        
               

    }
}

new Stage();
