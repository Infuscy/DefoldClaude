# Defold 1.14.0 Lua API — core cheatsheet

Generated from the Defold 1.14.0 API documentation (sha1 d295ed4edff2e49072719835713e625f409849f1). One line per entry: signature — summary.
For parameters, return values and examples call the `api` tool with `name=<entry>`; for anything not listed here use `api` with `query=`.
Optional parameters are in [brackets]. Messages are sent with `msg.post(url, "<name>", {fields})` and received in `on_message` (compare `message_id == hash("<name>")`).

## go — Game objects, properties, animation, lifecycle

- `final(self)` — called when a script component is finalized
- `fixed_update(self, dt)` — called at fixed intervals to update the script component
- `go.animate(url, property, playback, to, easing, duration, [delay], [complete_function])` — animates a named property of the specified game object or component
- `go.cancel_animations(url, [property])` — cancels all or specified property animations of the game object or component
- `go.delete([id], [recursive])` — delete one or more game object instances
- `go.exists(url)` — check if the specified game object exists
- `go.get(url, property, [options])` — gets a named property of the specified game object or component
- `go.get_id([path])` — gets the id of an instance
- `go.get_parent([id])` — get the parent for a specific game object instance
- `go.get_position([id])` — gets the position of a game object instance
- `go.get_rotation([id])` — gets the rotation of the game object instance
- `go.get_scale([id])` — gets the 3D scale factor of the game object instance
- `go.get_scale_uniform([id])` — gets the uniform scale factor of the game object instance
- `go.get_world_position([id])` — gets the game object instance world position
- `go.get_world_rotation([id])` — gets the game object instance world rotation
- `go.get_world_scale([id])` — gets the game object instance world 3D scale factor
- `go.get_world_scale_uniform([id])` — gets the uniform game object instance world scale factor
- `go.get_world_transform([id])` — gets the game object instance world transform matrix
- `go.property(name, value)` — define a property for the script
- `go.set(url, property, value, [options])` — sets a named property of the specified game object or component, or a material constant
- `go.set_parent([id], [parent_id], [keep_world_transform])` — sets the parent for a specific game object instance
- `go.set_position(position, [id])` — sets the position of the game object instance
- `go.set_rotation(rotation, [id])` — sets the rotation of the game object instance
- `go.set_scale(scale, [id])` — sets the scale factor of the game object instance
- `go.set_scale_xy(scale, [id])` — sets the scale factor only for width and height (x and y) of the game object instance
- `go.update_world_transform([id])` — updates the world transform for a game object instance
- `go.world_to_local_position(position, url)` — convert position to game object's coordinate space
- `go.world_to_local_transform(transformation, url)` — convert transformation matrix to game object's coordinate space
- `init(self)` — called when a script component is initialized
- `late_update(self, dt)` — called at the end of the frame for a final update of the script component
- `on_input(self, action_id, action)` — called when user input is received
- `on_message(self, message_id, message, sender)` — called when a message has been sent to the script component
- `on_reload(self)` — called when the script component is reloaded
- `update(self, dt)` — called every frame to update the script component

Messages:
- `acquire_input_focus` — acquires the user input focus
- `disable` — disables the receiving component
- `enable` — enables the receiving component
- `release_input_focus` — releases the user input focus
- `set_parent` {parent_id, keep_world_transform} — sets the parent of the receiving instance

Properties (go.get/go.set/go.animate):
`euler` (vector3 game object euler rotation), `position` (vector3 game object position), `rotation` (quaternion game object rotation), `scale` (number game object scale)

Constants: `go.EASING_INBACK`, `go.EASING_INBOUNCE`, `go.EASING_INCIRC`, `go.EASING_INCUBIC`, `go.EASING_INELASTIC`, `go.EASING_INEXPO`, `go.EASING_INOUTBACK`, `go.EASING_INOUTBOUNCE`, `go.EASING_INOUTCIRC`, `go.EASING_INOUTCUBIC`, `go.EASING_INOUTELASTIC`, `go.EASING_INOUTEXPO`, `go.EASING_INOUTQUAD`, `go.EASING_INOUTQUART`, `go.EASING_INOUTQUINT`, `go.EASING_INOUTSINE`, `go.EASING_INQUAD`, `go.EASING_INQUART`, `go.EASING_INQUINT`, `go.EASING_INSINE`, `go.EASING_LINEAR`, `go.EASING_OUTBACK`, `go.EASING_OUTBOUNCE`, `go.EASING_OUTCIRC`, `go.EASING_OUTCUBIC`, `go.EASING_OUTELASTIC`, `go.EASING_OUTEXPO`, `go.EASING_OUTINBACK`, `go.EASING_OUTINBOUNCE`, `go.EASING_OUTINCIRC`, `go.EASING_OUTINCUBIC`, `go.EASING_OUTINELASTIC`, `go.EASING_OUTINEXPO`, `go.EASING_OUTINQUAD`, `go.EASING_OUTINQUART`, `go.EASING_OUTINQUINT`, `go.EASING_OUTINSINE`, `go.EASING_OUTQUAD`, `go.EASING_OUTQUART`, `go.EASING_OUTQUINT`, `go.EASING_OUTSINE`, `go.PLAYBACK_LOOP_BACKWARD`, `go.PLAYBACK_LOOP_FORWARD`, `go.PLAYBACK_LOOP_PINGPONG`, `go.PLAYBACK_NONE`, `go.PLAYBACK_ONCE_BACKWARD`, `go.PLAYBACK_ONCE_FORWARD`, `go.PLAYBACK_ONCE_PINGPONG`

## msg — Messaging

- `msg.post(receiver, message_id, [message])` — posts a message to a receiving URL
- `msg.url()` — creates a new URL
- `msg.url(urlstring)` — creates a new URL from a string
- `msg.url([socket], [path], [fragment])` — creates a new URL from separate arguments

## vmath — Vector math

- `vmath.clamp(value, min, max)` — clamp input value in range [min, max] and return clamped value
- `vmath.conj(q1)` — calculates the conjugate of a quaternion
- `vmath.cross(v1, v2)` — calculates the cross-product of two vectors
- `vmath.dot(v1, v2)` — calculates the dot-product of two vectors
- `vmath.euler_to_quat(x, [y], [z])` — converts euler angles into a quaternion
- `vmath.inv(m1)` — calculates the inverse matrix.
- `vmath.length(v)` — calculates the length of a vector or quaternion
- `vmath.length_sqr(v)` — calculates the squared length of a vector or quaternion
- `vmath.lerp(t, v1, v2)` — lerps between two vectors
- `vmath.lerp(t, q1, q2)` — lerps between two quaternions
- `vmath.lerp(t, n1, n2)` — lerps between two numbers
- `vmath.matrix4()` — creates a new identity matrix
- `vmath.matrix4(m1)` — creates a new matrix from another existing matrix
- `vmath.matrix4_axis_angle(v, angle)` — creates a matrix from an axis and an angle
- `vmath.matrix4_compose(translation, rotation, scale)` — creates a new matrix4 from translation, rotation and scale
- `vmath.matrix4_frustum(left, right, bottom, top, near, far)` — creates a frustum matrix
- `vmath.matrix4_look_at(eye, look_at, up)` — creates a look-at view matrix
- `vmath.matrix4_orthographic(left, right, bottom, top, near, far)` — creates an orthographic projection matrix
- `vmath.matrix4_perspective(fov, aspect, near, far)` — creates a perspective projection matrix
- `vmath.matrix4_quat(q)` — creates a matrix from a quaternion
- `vmath.matrix4_rotation_x(angle)` — creates a matrix from rotation around x-axis
- `vmath.matrix4_rotation_y(angle)` — creates a matrix from rotation around y-axis
- `vmath.matrix4_rotation_z(angle)` — creates a matrix from rotation around z-axis
- `vmath.matrix4_scale(scale)` — creates a new matrix4 from scale vector
- `vmath.matrix4_scale(scale)` — creates a new matrix4 from uniform scale
- `vmath.matrix4_scale(scale_x, scale_y, scale_z)` — creates a new matrix4 from three scale components
- `vmath.matrix4_translation(position)` — creates a translation matrix from a position vector
- `vmath.mul_per_elem(v1, v2)` — performs an element wise multiplication of two vectors
- `vmath.normalize(v1)` — normalizes a vector
- `vmath.ortho_inv(m1)` — calculates the inverse of an ortho-normal matrix.
- `vmath.project(v1, v2)` — projects a vector onto another vector
- `vmath.quat()` — creates a new identity quaternion
- `vmath.quat(q1)` — creates a new quaternion from another existing quaternion
- `vmath.quat(x, y, z, w)` — creates a new quaternion from its coordinates
- `vmath.quat_axis_angle(v, angle)` — creates a quaternion to rotate around a unit vector
- `vmath.quat_basis(x, y, z)` — creates a quaternion from three base unit vectors
- `vmath.quat_from_to(v1, v2)` — creates a quaternion to rotate between two unit vectors
- `vmath.quat_matrix4(matrix)` — creates a new quaternion from matrix4
- `vmath.quat_rotation_x(angle)` — creates a quaternion from rotation around x-axis
- `vmath.quat_rotation_y(angle)` — creates a quaternion from rotation around y-axis
- `vmath.quat_rotation_z(angle)` — creates a quaternion from rotation around z-axis
- `vmath.quat_to_euler(q)` — converts a quaternion into euler angles
- `vmath.rotate(q, v1)` — rotates a vector by a quaternion
- `vmath.slerp(t, v1, v2)` — slerps between two vectors
- `vmath.slerp(t, q1, q2)` — slerps between two quaternions
- `vmath.vector(t)` — create a new vector from a table of values
- `vmath.vector3()` — creates a new zero vector
- `vmath.vector3(n)` — creates a new vector from scalar value
- `vmath.vector3(v1)` — creates a new vector from another existing vector
- `vmath.vector3(x, y, z)` — creates a new vector from its coordinates
- `vmath.vector4()` — creates a new zero vector
- `vmath.vector4(n)` — creates a new vector from scalar value
- `vmath.vector4(v1)` — creates a new vector from another existing vector
- `vmath.vector4(x, y, z, w)` — creates a new vector from its coordinates

## builtins — Global helpers

- `hash(s)` — hashes a string
- `hash_to_hex(h)` — get hex representation of a hash value as a string
- `pprint(...)` — pretty printing

## sprite — Sprite component

- `sprite.play_flipbook(url, id, [complete_function], [play_properties])` — Play an animation on a sprite component
- `sprite.reset_constant(url, constant)` — DEPRECATED! reset a shader constant for a sprite
- `sprite.set_hflip(url, flip)` — set horizontal flipping on a sprite's animations
- `sprite.set_vflip(url, flip)` — set vertical flipping on a sprite's animations

Messages:
- `animation_done` {current_tile, id} — reports that an animation has completed
- `play_animation` {id, offset, playback_rate} — play a sprite animation

Properties (go.get/go.set/go.animate):
`animation` (hash sprite animation), `cursor` (number sprite cursor), `frame_count` (hash sprite frame_count), `image` (hash sprite image), `material` (hash sprite material), `playback_rate` (number sprite playback_rate), `scale` (vector3 sprite scale), `size` (vector3 sprite size), `slice` (vector4 sprite slice)

## label — Label component

- `label.get_layout_objects(url)` — gets the markup objects for a label
- `label.get_text(url)` — gets the text for a label
- `label.set_text(url, text)` — set the text for a label

Messages:
- `text_object_clicked` {id, type, src} — Sent to the owning game object when an interactive rich-text object is clicked.
- `text_object_hovered` {id, type, src} — Sent to the owning game object when the pointer enters an interactive rich-text object.
- `text_object_unhovered` {id, type, src} — Sent to the owning game object when the pointer leaves an interactive rich-text object.

Properties (go.get/go.set/go.animate):
`color` (vector4 label color), `font` (hash label font), `leading` (number label leading), `line_break` (boolean label line break), `material` (hash label material), `outline` (vector4 label outline), `scale` (number|vector3 label scale), `shadow` (vector4 label shadow), `size` (vector3 label size), `text` (string label text), `tracking` (number label tracking)

## factory — Factory component

- `factory.create(url, [position], [rotation], [properties], [scale])` — make a factory create a new game object
- `factory.get_status([url])` — Get factory status
- `factory.load([url], [complete_function])` — Load resources of a factory prototype.
- `factory.set_prototype([url], [prototype])` — changes the prototype for the factory
- `factory.unload([url])` — Unload resources previously loaded using factory.load

Constants: `factory.STATUS_LOADED`, `factory.STATUS_LOADING`, `factory.STATUS_UNLOADED`

## collectionfactory — Collection factory component

- `collectionfactory.create(url, [position], [rotation], [properties], [scale])` — Spawn a new instance of a collection into the existing collection.
- `collectionfactory.get_status([url])` — Get collection factory status
- `collectionfactory.load([url], [complete_function])` — Load resources of a collection factory prototype.
- `collectionfactory.set_prototype([url], [prototype])` — changes the prototype for the collection factory
- `collectionfactory.unload([url])` — Unload resources previously loaded using collectionfactory.load

Constants: `collectionfactory.STATUS_LOADED`, `collectionfactory.STATUS_LOADING`, `collectionfactory.STATUS_UNLOADED`

## collectionproxy — Collection proxy component

- `collectionproxy.get_resources(collectionproxy)` — return an indexed table of all the resources of a collection proxy
- `collectionproxy.load(url, options, callback)` — load a collection proxy
- `collectionproxy.set_collection([url], [prototype])` — changes the collection for a collection proxy.

Messages:
- `async_load` — tells a collection proxy to start asynchronous loading of the referenced collection
- `disable` — tells a collection proxy to disable the referenced collection
- `enable` — tells a collection proxy to enable the referenced collection
- `final` — tells a collection proxy to finalize the referenced collection
- `init` — tells a collection proxy to initialize the loaded collection
- `load` — tells a collection proxy to start loading the referenced collection
- `proxy_error` {code} — reports that an error occurred while loading or initializing a collection
- `proxy_loaded` — reports that a collection proxy has loaded its referenced collection
- `proxy_loading` {progress} — reports that a collection proxy is loading
- `proxy_ready` — reports that a collection proxy has been loaded and is running
- `proxy_unloaded` — reports that a collection proxy has unloaded its referenced collection
- `set_time_step` {factor, mode} — sets the time-step for update
- `unload` — tells a collection proxy to start unloading the referenced collection

Constants: `collectionproxy.RESULT_ALREADY_LOADED`, `collectionproxy.RESULT_LOADING`, `collectionproxy.RESULT_NOT_EXCLUDED`

## physics — Physics (high level)

- `physics.create_joint(joint_type, collisionobject_a, joint_id, position_a, collisionobject_b, position_b, [properties])` — create a physics joint
- `physics.destroy_joint(collisionobject, joint_id)` — destroy a physics joint
- `physics.get_gravity()` — get the gravity for collection
- `physics.get_group(url)` — returns the group of a collision object
- `physics.get_joint_properties(collisionobject, joint_id)` — get properties for a joint
- `physics.get_joint_reaction_force(collisionobject, joint_id)` — get the reaction force for a joint
- `physics.get_joint_reaction_torque(collisionobject, joint_id)` — get the reaction torque for a joint
- `physics.get_maskbit(url, group)` — checks the presense of a group in the mask (maskbit) of a collision object
- `physics.get_shape(url, shape)` — get collision shape info
- `physics.raycast(from, to, groups, [options])` — requests a ray cast to be performed
- `physics.raycast_async(from, to, groups, [request_id])` — requests a ray cast to be performed
- `physics.set_event_listener(callback)` — Sets a physics world event listener. If a function is set, physics messages will no longer be sent to on_mess…
- `physics.set_gravity(gravity)` — set the gravity for collection
- `physics.set_group(url, group)` — change the group of a collision object
- `physics.set_hflip(url, flip)` — flip the geometry horizontally for a collision object
- `physics.set_joint_properties(collisionobject, joint_id, properties)` — set properties for a joint
- `physics.set_maskbit(url, group, maskbit)` — updates the mask of a collision object
- `physics.set_shape(url, shape, table)` — set collision shape data
- `physics.set_vflip(url, flip)` — flip the geometry vertically for a collision object
- `physics.update_mass(collisionobject, mass)` — updates the mass of a dynamic 2D collision object in the physics world.
- `physics.wakeup(url)` — explicitly wakeup a collision object

Messages:
- `apply_force` {force, position} — applies a force on a collision object
- `collision_event` {a, b} — reports a collision between two collision objects in cases where a listener is specified.
- `collision_response` {other_id, other_position, other_group, own_group} — reports a collision between two collision objects
- `contact_point_event` {applied_impulse, distance, a, b} — reports a contact point between two collision objects in cases where a listener is specif…
- `contact_point_response` {position, normal, relative_velocity, distance, applied_impulse, life_time, mass, other_mass, other_id, other_position, other_group, own_group} — reports a contact point between two collision objects
- `ray_cast_missed` {request_id} — reports a ray cast miss
- `ray_cast_response` {fraction, position, normal, id, group, request_id} — reports a ray cast hit
- `trigger_event` {enter, a, b} — reports interaction (enter/exit) between a trigger collision object and another collision…
- `trigger_response` {other_id, enter, other_group, own_group} — reports interaction (enter/exit) between a trigger collision object and another collision…

Properties (go.get/go.set/go.animate):
`angular_damping` (number collision object angular damping), `angular_velocity` (vector3 collision object angular veloci…), `linear_damping` (number collision object linear damping), `linear_velocity` (vector3 collision object linear velocity), `mass` (number collision object mass)

Constants: `physics.JOINT_TYPE_FIXED`, `physics.JOINT_TYPE_HINGE`, `physics.JOINT_TYPE_SLIDER`, `physics.JOINT_TYPE_SPRING`, `physics.JOINT_TYPE_WELD`, `physics.JOINT_TYPE_WHEEL`, `physics.SHAPE_TYPE_BOX`, `physics.SHAPE_TYPE_CAPSULE`, `physics.SHAPE_TYPE_HULL`, `physics.SHAPE_TYPE_MESH`, `physics.SHAPE_TYPE_SPHERE`

## camera — Camera

- `camera.get_aspect_ratio(camera)` — get aspect ratio
- `camera.get_auto_aspect_ratio(camera)` — get auto aspect ratio
- `camera.get_cameras()` — get all camera URLs
- `camera.get_enabled(camera)` — get enabled
- `camera.get_far_z(camera)` — get far z
- `camera.get_fov(camera)` — get field of view
- `camera.get_near_z(camera)` — get near z
- `camera.get_orthographic_auto_zoom(camera)` — get orthographic auto zoom
- `camera.get_orthographic_mode(camera)` — get orthographic zoom mode
- `camera.get_orthographic_zoom(camera)` — get orthographic zoom
- `camera.get_projection(camera)` — get projection matrix
- `camera.get_view(camera)` — get view matrix
- `camera.screen_to_world(pos, [camera])` — Convert screen vector3 position to world
- `camera.screen_xy_to_world(x, y, [camera])` — Convert screen XY to world point at near plane
- `camera.set_aspect_ratio(camera, aspect_ratio)` — set aspect ratio
- `camera.set_auto_aspect_ratio(camera, auto_aspect_ratio)` — set auto aspect ratio
- `camera.set_far_z(camera, far_z)` — set far z
- `camera.set_fov(camera, fov)` — set field of view
- `camera.set_near_z(camera, near_z)` — set near z
- `camera.set_orthographic_mode(camera, mode)` — set orthographic zoom mode
- `camera.set_orthographic_zoom(camera, orthographic_zoom)` — set orthographic zoom
- `camera.world_to_screen(world_pos, [camera])` — Convert world vector3 position to screen

Messages:
- `acquire_camera_focus` — DEPRECATED! makes the receiving camera become the active camera
- `release_camera_focus` — DEPRECATED! deactivates the receiving camera
- `set_camera` {aspect_ratio, fov, near_z, far_z, orthographic_projection, orthographic_zoom, orthographic_mode} — sets camera properties

Properties (go.get/go.set/go.animate):
`aspect_ratio` (number camera aspect ratio), `far_z` (number camera far_z), `fov` (number camera fov), `near_z` (number camera near_z), `orthographic_auto_zoom` (number camera orthographic_auto_zoom), `orthographic_zoom` (number camera orthographic_zoom), `projection` (matrix4 camera projection), `view` (matrix4 camera view)

Constants: `camera.ORTHO_MODE_AUTO_COVER`, `camera.ORTHO_MODE_AUTO_FIT`, `camera.ORTHO_MODE_FIXED`

## gui — GUI scripts

- `final(self)` — called when a gui component is finalized
- `gui.animate(node, property, to, easing, duration, [delay], [complete_function], [playback])` — animates a node property
- `gui.cancel_animations(node, [property])` — cancels a single animation or all animations
- `gui.cancel_flipbook(node)` — cancel a node flipbook animation
- `gui.clone(node)` — clone a node
- `gui.clone_tree(node)` — clone a node including its children
- `gui.delete_node(node)` — deletes a node
- `gui.delete_texture(texture)` — delete texture
- `gui.get(node, property, [options])` — gets the named property of a specified gui node
- `gui.get_adjust_mode(node)` — gets the node adjust mode
- `gui.get_alpha(node)` — gets the node alpha
- `gui.get_blend_mode(node)` — gets the node blend mode
- `gui.get_clipping_inverted(node)` — gets node clipping inverted state
- `gui.get_clipping_mode(node)` — gets the node clipping mode
- `gui.get_clipping_visible(node)` — gets node clipping visibility state
- `gui.get_color(node)` — gets the node color
- `gui.get_euler(node)` — gets the node rotation
- `gui.get_fill_angle(node)` — gets the angle for the filled pie sector
- `gui.get_flipbook(node)` — gets the node flipbook animation
- `gui.get_flipbook_cursor(node)` — gets the normalized cursor of the animation on a node with flipbook animation
- `gui.get_flipbook_playback_rate(node)` — gets the playback rate of the flipbook animation on a node
- `gui.get_font(node)` — gets the node font
- `gui.get_font_resource(font_name)` — gets the node font resource
- `gui.get_height()` — gets the scene height
- `gui.get_id(node)` — gets the id of the specified node
- `gui.get_index(node)` — gets the index of the specified node
- `gui.get_inherit_alpha(node)` — gets the node inherit alpha state
- `gui.get_inner_radius(node)` — gets the pie inner radius
- `gui.get_layer(node)` — gets the node layer
- `gui.get_layout()` — gets the scene current layout
- `gui.get_layout_objects(node)` — gets the markup objects for a text node
- `gui.get_layouts()` — returns available layouts with sizes
- `gui.get_leading(node)` — gets the leading of the text node
- `gui.get_line_break(node)` — get line-break mode
- `gui.get_material(node)` — gets the assigned node material
- `gui.get_node(id)` — gets the node with the specified id
- `gui.get_outer_bounds(node)` — gets the pie outer bounds mode
- `gui.get_outline(node)` — gets the node outline color
- `gui.get_parent(node)` — gets the parent of the specified node
- `gui.get_particlefx(node)` — Gets a particle fx
- `gui.get_perimeter_vertices(node)` — gets the number of generated vertices around the perimeter
- `gui.get_pivot(node)` — gets the pivot of a node
- `gui.get_position(node)` — gets the node position
- `gui.get_rotation(node)` — gets the node rotation
- `gui.get_scale(node)` — gets the node scale
- `gui.get_screen_position(node)` — gets the node screen position
- `gui.get_shadow(node)` — gets the node shadow color
- `gui.get_size(node)` — gets the node size
- `gui.get_size_mode(node)` — gets the node size mode
- `gui.get_slice9(node)` — get the slice9 values for the node
- `gui.get_text(node)` — gets the node text
- `gui.get_texture(node)` — gets node texture
- `gui.get_tracking(node)` — gets the tracking of the text node
- `gui.get_tree(node)` — get a node including its children
- `gui.get_type(node)` — gets the node type
- `gui.get_visible(node)` — returns if a node is visible or not
- `gui.get_width()` — gets the scene width
- `gui.get_xanchor(node)` — gets the x-anchor of a node
- `gui.get_yanchor(node)` — gets the y-anchor of a node
- `gui.hide_keyboard()` — hides on-display keyboard if available
- `gui.is_enabled(node, [recursive])` — returns if a node is enabled or not
- `gui.move_above(node, reference)` — moves the first node above the second
- `gui.move_below(node, reference)` — moves the first node below the second
- `gui.new_box_node(pos, size)` — creates a new box node
- `gui.new_particlefx_node(pos, particlefx)` — creates a new particle fx node
- `gui.new_pie_node(pos, size)` — creates a new pie node
- `gui.new_text_node(pos, text)` — creates a new text node
- `gui.new_texture(texture_id, width, height, type, buffer, flip)` — create new texture
- `gui.pick_node(node, x, y)` — determines if the node is pickable by the supplied coordinates
- `gui.play_flipbook(node, animation, [complete_function], [play_properties])` — play node flipbook animation
- `gui.play_particlefx(node, [emitter_state_function])` — Plays a particle fx
- `gui.reset_keyboard()` — resets on-display keyboard if available
- `gui.reset_material(node)` — resets the node material
- `gui.reset_nodes()` — resets all nodes to initial state
- `gui.screen_to_local(node, screen_position)` — convert a screen position to a node position
- `gui.set(node, property, value, [options])` — sets the named property of a specified gui node
- `gui.set_adjust_mode(node, adjust_mode)` — sets node adjust mode
- `gui.set_alpha(node, alpha)` — sets the node alpha
- `gui.set_blend_mode(node, blend_mode)` — sets node blend mode
- `gui.set_clipping_inverted(node, inverted)` — sets node clipping inversion
- `gui.set_clipping_mode(node, clipping_mode)` — sets node clipping mode state
- `gui.set_clipping_visible(node, visible)` — sets node clipping visibility
- `gui.set_color(node, color)` — sets the node color
- `gui.set_enabled(node, enabled)` — enables/disables a node
- `gui.set_euler(node, rotation)` — sets the node rotation
- `gui.set_fill_angle(node, angle)` — sets the angle for the filled pie sector
- `gui.set_flipbook_cursor(node, cursor)` — sets the normalized cursor of the animation on a node with flipbook animation
- `gui.set_flipbook_playback_rate(node, playback_rate)` — sets the playback rate of the flipbook animation on a node
- `gui.set_font(node, font)` — sets the node font
- `gui.set_id(node, id)` — sets the id of the specified node
- `gui.set_inherit_alpha(node, inherit_alpha)` — sets the node inherit alpha state
- `gui.set_inner_radius(node, radius)` — sets the pie inner radius
- `gui.set_layer(node, layer)` — sets the node layer
- `gui.set_layout(layout)` — sets the scene layout
- `gui.set_leading(node, leading)` — sets the leading of the text node
- `gui.set_line_break(node, line_break)` — set line-break mode
- `gui.set_material(node, material)` — sets the node material
- `gui.set_outer_bounds(node, bounds_mode)` — sets the pie node outer bounds mode
- `gui.set_outline(node, color)` — sets the node outline color
- `gui.set_parent(node, [parent], [keep_scene_transform])` — sets the parent of the node
- `gui.set_particlefx(node, particlefx)` — Sets a particle fx
- `gui.set_perimeter_vertices(node, vertices)` — sets the number of generated vertices around the perimeter
- `gui.set_pivot(node, pivot)` — sets the pivot of a node
- `gui.set_position(node, position)` — sets the node position
- `gui.set_render_order(order)` — sets the render ordering for the current GUI scene
- `gui.set_rotation(node, rotation)` — sets the node rotation
- `gui.set_safe_area_mode(mode)` — sets the safe area mode for the gui scene
- `gui.set_scale(node, scale)` — sets the node scale
- `gui.set_screen_position(node, screen_position)` — sets screen position to the node
- `gui.set_shadow(node, color)` — sets the node shadow color
- `gui.set_size(node, size)` — sets the node size
- `gui.set_size_mode(node, size_mode)` — sets node size mode
- `gui.set_slice9(node, values)` — set the slice9 configuration for the node
- `gui.set_text(node, text)` — sets the node text
- `gui.set_texture(node, texture)` — sets the node texture
- `gui.set_texture_data(texture, width, height, type, buffer, flip)` — set the buffer data for a texture
- `gui.set_tracking(node, tracking)` — sets the tracking of the text node
- `gui.set_visible(node, visible)` — set visibility for a node
- `gui.set_xanchor(node, anchor)` — sets the x-anchor of a node
- `gui.set_yanchor(node, anchor)` — sets the y-anchor of a node
- `gui.show_keyboard(type, autoclose)` — shows the on-display keyboard if available
- `gui.stop_particlefx(node, [options])` — Stops a particle fx
- `init(self)` — called when a gui component is initialized
- `on_input(self, action_id, action)` — called when user input is received
- `on_message(self, message_id, message, sender)` — called when a message has been sent to the gui component
- `on_reload(self)` — called when the gui script is reloaded
- `update(self, dt)` — called every frame to update the gui component

Messages:
- `layout_changed` {id, previous_id} — reports a layout change
- `text_object_clicked` {id, type, src} — Sent to the GUI script when an interactive rich-text object is clicked.
- `text_object_hovered` {id, type, src} — Sent to the GUI script when the pointer enters an interactive rich-text object.
- `text_object_unhovered` {id, type, src} — Sent to the GUI script when the pointer leaves an interactive rich-text object.

Properties (go.get/go.set/go.animate):
`fonts` (hash gui fonts), `material` (hash gui material), `materials` (hash gui materials), `textures` (hash gui textures)

Constants: `gui.ADJUST_FIT`, `gui.ADJUST_STRETCH`, `gui.ADJUST_ZOOM`, `gui.ANCHOR_BOTTOM`, `gui.ANCHOR_LEFT`, `gui.ANCHOR_NONE`, `gui.ANCHOR_RIGHT`, `gui.ANCHOR_TOP`, `gui.BLEND_ADD`, `gui.BLEND_ADD_ALPHA`, `gui.BLEND_ALPHA`, `gui.BLEND_MULT`, `gui.BLEND_SCREEN`, `gui.CLIPPING_MODE_NONE`, `gui.CLIPPING_MODE_STENCIL`, `gui.EASING_INBACK`, `gui.EASING_INBOUNCE`, `gui.EASING_INCIRC`, `gui.EASING_INCUBIC`, `gui.EASING_INELASTIC`, `gui.EASING_INEXPO`, `gui.EASING_INOUTBACK`, `gui.EASING_INOUTBOUNCE`, `gui.EASING_INOUTCIRC`, `gui.EASING_INOUTCUBIC`, `gui.EASING_INOUTELASTIC`, `gui.EASING_INOUTEXPO`, `gui.EASING_INOUTQUAD`, `gui.EASING_INOUTQUART`, `gui.EASING_INOUTQUINT`, `gui.EASING_INOUTSINE`, `gui.EASING_INQUAD`, `gui.EASING_INQUART`, `gui.EASING_INQUINT`, `gui.EASING_INSINE`, `gui.EASING_LINEAR`, `gui.EASING_OUTBACK`, `gui.EASING_OUTBOUNCE`, `gui.EASING_OUTCIRC`, `gui.EASING_OUTCUBIC`, `gui.EASING_OUTELASTIC`, `gui.EASING_OUTEXPO`, `gui.EASING_OUTINBACK`, `gui.EASING_OUTINBOUNCE`, `gui.EASING_OUTINCIRC`, `gui.EASING_OUTINCUBIC`, `gui.EASING_OUTINELASTIC`, `gui.EASING_OUTINEXPO`, `gui.EASING_OUTINQUAD`, `gui.EASING_OUTINQUART`, `gui.EASING_OUTINQUINT`, `gui.EASING_OUTINSINE`, `gui.EASING_OUTQUAD`, `gui.EASING_OUTQUART`, `gui.EASING_OUTQUINT`, `gui.EASING_OUTSINE`, `gui.KEYBOARD_TYPE_DEFAULT`, `gui.KEYBOARD_TYPE_EMAIL`, `gui.KEYBOARD_TYPE_NUMBER_PAD`, `gui.KEYBOARD_TYPE_PASSWORD`, `gui.PIEBOUNDS_ELLIPSE`, `gui.PIEBOUNDS_RECTANGLE`, `gui.PIVOT_CENTER`, `gui.PIVOT_E`, `gui.PIVOT_N`, `gui.PIVOT_NE`, `gui.PIVOT_NW`, `gui.PIVOT_S`, `gui.PIVOT_SE`, `gui.PIVOT_SW`, `gui.PIVOT_W`, `gui.PLAYBACK_LOOP_BACKWARD`, `gui.PLAYBACK_LOOP_FORWARD`, `gui.PLAYBACK_LOOP_PINGPONG`, `gui.PLAYBACK_ONCE_BACKWARD`, `gui.PLAYBACK_ONCE_FORWARD`, `gui.PLAYBACK_ONCE_PINGPONG`, `gui.PROP_COLOR`, `gui.PROP_EULER`, `gui.PROP_FILL_ANGLE`, `gui.PROP_INNER_RADIUS`, `gui.PROP_LEADING`, `gui.PROP_OUTLINE`, `gui.PROP_POSITION`, `gui.PROP_ROTATION`, `gui.PROP_SCALE`, `gui.PROP_SHADOW`, `gui.PROP_SIZE`, `gui.PROP_SLICE9`, `gui.PROP_TRACKING`, `gui.RESULT_DATA_ERROR`, `gui.RESULT_OUT_OF_RESOURCES`, `gui.RESULT_TEXTURE_ALREADY_EXISTS`, `gui.SAFE_AREA_BOTH`, `gui.SAFE_AREA_LONG`, `gui.SAFE_AREA_NONE`, `gui.SAFE_AREA_SHORT`, `gui.SIZE_MODE_AUTO`, `gui.SIZE_MODE_MANUAL`, `gui.TYPE_BOX`, `gui.TYPE_CUSTOM`, `gui.TYPE_PARTICLEFX`, `gui.TYPE_PIE`, `gui.TYPE_TEXT`

## sound — Sound

- `sound.get_group_gain(group)` — get mixer group gain
- `sound.get_group_name(group)` — get mixer group name string
- `sound.get_groups()` — get all mixer group names
- `sound.get_peak(group, window)` — get peak gain value from mixer group
- `sound.get_rms(group, window)` — get RMS value from mixer group
- `sound.is_music_playing()` — check if background music is playing
- `sound.is_phone_call_active()` — check if a phone call is active
- `sound.pause(url, pause)` — pause a playing a sound(s)
- `sound.play(url, [play_properties], [complete_function])` — plays a sound
- `sound.set_gain(url, [gain])` — set sound gain
- `sound.set_group_gain(group, gain)` — set mixer group gain
- `sound.set_pan(url, [pan])` — set sound pan
- `sound.stop(url, [stop_properties])` — stop a playing a sound(s)

Messages:
- `play_sound` {delay, gain, play_id, start_time, start_frame} — plays a sound
- `set_gain` {gain} — set sound gain
- `sound_done` {play_id} — reports when a sound has finished playing
- `sound_stopped` {play_id} — reports when a sound has been manually stopped
- `stop_sound` — stop a playing a sound(s)

Properties (go.get/go.set/go.animate):
`gain` (number sound gain), `pan` (number sound pan), `sound` (hash sound data), `speed` (number sound speed)

## particlefx — Particle effects

- `particlefx.play(url, [emitter_state_function])` — start playing a particle FX
- `particlefx.reset_constant(url, emitter, constant)` — reset a shader constant for a particle FX component emitter
- `particlefx.set_constant(url, emitter, constant, value)` — set a shader constant for a particle FX component emitter
- `particlefx.stop(url, [options])` — stop playing a particle fx

Properties (go.get/go.set/go.animate):
`animation` (hash particlefx animation), `image` (hash particlefx image), `material` (hash particlefx material)

Constants: `particlefx.EMITTER_STATE_POSTSPAWN`, `particlefx.EMITTER_STATE_PRESPAWN`, `particlefx.EMITTER_STATE_SLEEPING`, `particlefx.EMITTER_STATE_SPAWNING`

## tilemap — Tile maps

- `tilemap.get_bounds(url)` — get the bounds of a tile map
- `tilemap.get_tile(url, layer, x, y)` — get a tile from a tile map
- `tilemap.get_tile_info(url, layer, x, y)` — get full information for a tile from a tile map
- `tilemap.get_tiles(url, layer)` — get all the tiles from a layer in a tilemap
- `tilemap.reset_constant(url, constant)` — DEPRECATED! reset a shader constant for a tile map
- `tilemap.set_tile(url, layer, x, y, tile, [transform_bitmask])` — set a tile in a tile map
- `tilemap.set_visible(url, layer, visible)` — set the visibility of a layer

Properties (go.get/go.set/go.animate):
`material` (hash tile map material), `tile_source` (hash tile source)

Constants: `tilemap.H_FLIP`, `tilemap.ROTATE_180`, `tilemap.ROTATE_270`, `tilemap.ROTATE_90`, `tilemap.V_FLIP`

## model — Models

- `model.cancel(url)` — cancel all animation on a model
- `model.get_aabb(url)` — get the AABB of the whole model in local coordinate space
- `model.get_blend_weights(url)` — get current morph (blend shape) weights
- `model.get_go(url, bone_id)` — retrieve the game object corresponding to a model skeleton bone
- `model.get_mesh_aabb(url)` — get the AABB of all meshes
- `model.get_mesh_enabled(url, mesh_id)` — get the enabled state of a mesh
- `model.play_anim(url, anim_id, playback, [play_properties], [complete_function])` — play an animation on a model
- `model.reset_constant(url, constant)` — DEPRECATED! reset a shader constant for a model
- `model.set_blend_weights(url, [weights])` — set morph (blend shape) weights from a table
- `model.set_mesh_enabled(url, mesh_id, enabled)` — enable or disable a mesh

Messages:
- `model_animation_done` {animation_id, playback} — reports the completion of a Model animation

Properties (go.get/go.set/go.animate):
`animation` (hash model animation), `cursor` (number model cursor), `playback_rate` (number model playback_rate), `textureN` (hash model textureN where N is 0-7)

## timer — Timers

- `timer.cancel(handle)` — cancel a timer
- `timer.delay(delay, repeating, callback)` — create a timer
- `timer.get_info(handle)` — get information about timer
- `timer.trigger(handle)` — trigger a callback

Constants: `timer.INVALID_TIMER_HANDLE`

## sys — System, files, save data

- `sys.deserialize(buffer)` — deserializes buffer into a lua table
- `sys.exists(path)` — check if a path exists
- `sys.exit(code)` — exits application
- `sys.get_application_info(app_string)` — get application information
- `sys.get_application_path()` — gets the application path
- `sys.get_config_boolean(key, [default_value])` — get boolean config value with optional default value
- `sys.get_config_int(key, [default_value])` — get integer config value with optional default value
- `sys.get_config_number(key, [default_value])` — get number config value with optional default value
- `sys.get_config_string(key, [default_value])` — get string config value with optional default value
- `sys.get_connectivity()` — get current network connectivity status
- `sys.get_engine_info()` — get engine information
- `sys.get_host_path(filename)` — create a path to the host device for unit testing
- `sys.get_ifaddrs()` — enumerate network interfaces
- `sys.get_save_file(application_id, file_name)` — gets the save-file path
- `sys.get_sys_info([options])` — get system information
- `sys.load(filename)` — loads a lua table from a file on disk
- `sys.load_buffer(path)` — loads a buffer from a resource or disk path
- `sys.load_buffer_async(path, status_callback)` — loads a buffer from a resource or disk path asynchronously
- `sys.load_resource(filename)` — loads resource from game data
- `sys.open_url(url, [attributes])` — open url in default application
- `sys.reboot([arg1], [arg2], [arg3], [arg4], [arg5], [arg6])` — reboot engine with arguments
- `sys.save(filename, table)` — saves a lua table to a file stored on disk
- `sys.serialize(table)` — serializes a lua table to a buffer and returns it
- `sys.set_connectivity_host(host)` — set host to check for network connectivity against
- `sys.set_engine_throttle(enable, cooldown)` — Enables engine throttling.
- `sys.set_error_handler(error_handler)` — set the error handler
- `sys.set_render_enable(enable)` — Disables rendering
- `sys.set_update_frequency(frequency)` — set update frequency
- `sys.set_vsync_swap_interval(swap_interval)` — set vsync swap interval

Messages:
- `exit` {code} — exits application
- `reboot` {arg1, arg2, arg3, arg4, arg5, arg6} — reboot engine with arguments
- `resume_rendering` — resume rendering
- `set_update_frequency` {frequency} — set update frequency
- `set_vsync` {swap_interval} — set vsync swap interval
- `start_record` {file_name, frame_period, fps} — starts video recording
- `stop_record` — stop current video recording
- `toggle_physics_debug` — shows/hides the on-screen physics visual debugging
- `toggle_profile` — shows/hides the on-screen profiler

Constants: `sys.NETWORK_CONNECTED`, `sys.NETWORK_CONNECTED_CELLULAR`, `sys.NETWORK_DISCONNECTED`, `sys.REQUEST_STATUS_ERROR_IO_ERROR`, `sys.REQUEST_STATUS_ERROR_NOT_FOUND`, `sys.REQUEST_STATUS_FINISHED`

## window — Window

- `window.get_dim_mode()` — get the mode for screen dimming
- `window.get_display_scale()` — get the display scale
- `window.get_mouse_lock()` — get the cursor lock state
- `window.get_safe_area()` — get the safe area
- `window.get_size()` — get the window size
- `window.set_dim_mode(mode)` — set the mode for screen dimming
- `window.set_listener(callback)` — sets a window event listener
- `window.set_mouse_lock(flag)` — set the locking state for current mouse cursor
- `window.set_position(x, y)` — set the position of the window
- `window.set_size(width, height)` — set the size of the window
- `window.set_title(title)` — set the title of the window

Constants: `window.DIMMING_OFF`, `window.DIMMING_ON`, `window.DIMMING_UNKNOWN`, `window.WINDOW_EVENT_DEICONIFIED`, `window.WINDOW_EVENT_FOCUS_GAINED`, `window.WINDOW_EVENT_FOCUS_LOST`, `window.WINDOW_EVENT_ICONIFIED`, `window.WINDOW_EVENT_RESIZED`

## resource — Runtime resources

- `resource.atlas([path])` — reference to atlas resource
- `resource.buffer([path])` — reference to buffer resource
- `resource.create_atlas(path, table)` — create an atlas resource
- `resource.create_buffer(path, table)` — create a buffer resource
- `resource.create_sound_data(path, [options])` — Creates a sound data resource (.oggc/.opusc/.wavc)
- `resource.create_texture(path, table, [buffer])` — create a texture
- `resource.create_texture_async(path, table, [buffer], [callback])` — create a texture async
- `resource.font([path])` — reference to font resource
- `resource.get_atlas(path)` — Get atlas data
- `resource.get_buffer(path)` — get resource buffer
- `resource.get_render_target_info(path)` — get render target info
- `resource.get_text_metrics(url, text, [options])` — gets the text metrics for a font
- `resource.get_texture_info(path)` — get texture info
- `resource.load(path)` — load a resource
- `resource.material([path])` — reference to material resource
- `resource.release(path)` — release a resource
- `resource.render_target([path])` — reference to render target resource
- `resource.set(path, buffer)` — Set a resource
- `resource.set_atlas(path, table)` — set atlas data
- `resource.set_buffer(path, buffer, [table])` — set resource buffer
- `resource.set_sound(path, buffer)` — Update internal sound resource
- `resource.set_texture(path, table, buffer)` — set a texture
- `resource.texture([path])` — reference to texture resource
- `resource.tile_source([path])` — reference to tile source resource

## json — JSON

- `json.decode(json, [options])` — decode JSON from a string to a lua-table
- `json.encode(tbl, [options])` — encode a lua table to a JSON string

Constants: `json.null`

## http — HTTP

- `http.request(url, method, callback, [headers], [post_data], [options])` — perform a HTTP/HTTPS request

## render — Render scripts

- `render.clear(buffers)` — clears the active render target
- `render.constant_buffer()` — create a new constant buffer.
- `render.delete_render_target(render_target)` — deletes a render target
- `render.disable_material()` — disables the currently enabled material
- `render.disable_state(state)` — disables a render state
- `render.disable_texture(binding)` — disables a texture on the render state
- `render.dispatch_compute(x, y, z, [options])` — dispatches the currently enabled compute program
- `render.draw(predicate, [options])` — draws all objects matching a predicate
- `render.draw_debug3d([options])` — draws all 3d debug graphics
- `render.enable_material(material_id)` — enables a material
- `render.enable_state(state)` — enables a render state
- `render.enable_texture(binding, handle_or_name, [buffer_type])` — sets a texture to the render state
- `render.get_height()` — gets the window height, as specified for the project
- `render.get_render_target_height(render_target, buffer_type)` — retrieve a buffer height from a render target
- `render.get_render_target_width(render_target, buffer_type)` — retrieve the buffer width from a render target
- `render.get_width()` — gets the window width, as specified for the project
- `render.get_window_height()` — gets the actual window height
- `render.get_window_width()` — gets the actual window width
- `render.predicate(tags)` — creates a new render predicate
- `render.render_target(parameters)` — creates a new render target
- `render.set_blend_equation_separate(equation_color, equation_alpha)` — sets the blend equation with separate equations for color and alpha
- `render.set_blend_func(source_factor, destination_factor)` — sets the blending function
- `render.set_blend_func_separate(source_factor_color, destination_factor_color, source_factor_alpha, destination_factor_alpha)` — sets the blend function with separate factors for color and alpha
- `render.set_camera(camera, [options])` — sets the current render camera to be used for rendering
- `render.set_color_mask(red, green, blue, alpha)` — sets the color mask
- `render.set_compute(compute)` — set the current compute program
- `render.set_cull_face(face_type)` — sets the cull face
- `render.set_depth_func(func)` — sets the depth test function
- `render.set_depth_mask(depth)` — sets the depth mask
- `render.set_listener(callback)` — set render's event listener
- `render.set_polygon_offset(factor, units)` — sets the polygon offset
- `render.set_projection(matrix)` — sets the projection matrix
- `render.set_render_target([render_target], [options])` — sets a render target
- `render.set_render_target_size(render_target, width, height)` — sets the render target size
- `render.set_stencil_func(func, ref, mask)` — sets the stencil test function
- `render.set_stencil_mask(mask)` — sets the stencil mask
- `render.set_stencil_op(sfail, dpfail, dppass)` — sets the stencil operator
- `render.set_view(matrix)` — sets the view matrix
- `render.set_viewport(x, y, width, height)` — sets the render viewport

Messages:
- `clear_color` {color} — set clear color
- `draw_debug_text` {position, text, color} — draw a text on the screen
- `draw_line` {start_point, end_point, color} — draw a line on the screen
- `resize` {height, width} — resizes the window
- `window_resized` {height, width} — reports a window size change

Constants: `render.RENDER_TARGET_DEFAULT`, `render.CONTEXT_EVENT_CONTEXT_LOST`, `render.CONTEXT_EVENT_CONTEXT_RESTORED`, `render.FRUSTUM_PLANES_ALL`, `render.FRUSTUM_PLANES_SIDES`, `render.TEXTURE_BIT`, `render.SORT_BACK_TO_FRONT`, `render.SORT_FRONT_TO_BACK`, `render.SORT_NONE`
