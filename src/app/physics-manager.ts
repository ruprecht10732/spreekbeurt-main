import * as THREE from 'three';
import RAPIER, {
  type Collider,
  ColliderDesc,
  type RigidBody,
  RigidBodyDesc,
  type World,
} from '@dimforge/rapier3d-compat';

export type PhysicsBodyKind = 'dynamic' | 'kinematic' | 'fixed';
export type PhysicsColliderKind = 'ball' | 'box' | 'capsule';

export interface PhysicsBridgeOptions {
  kind: PhysicsBodyKind;
  collider: PhysicsColliderKind;
  radius?: number;
  halfExtents?: THREE.Vector3;
  halfHeight?: number;
  mass?: number;
  linearDamping?: number;
  angularDamping?: number;
  ccd?: boolean;
  canSleep?: boolean;
  gravityScale?: number;
}

interface PhysicsBridge {
  object: THREE.Object3D;
  body: RigidBody;
  collider: Collider;
  kind: PhysicsBodyKind;
  prevPosition: THREE.Vector3;
  prevQuaternion: THREE.Quaternion;
}

export class PhysicsManager {
  readonly scale = 100;

  private world!: World;
  private readonly fixedTimestep = 1 / 60;
  private accumulator = 0;
  private lastStepTime = 0;
  private initialized = false;
  private readonly bridges = new Map<THREE.Object3D, PhysicsBridge>();
  private playerObject: THREE.Object3D | null = null;

  // Pre-allocated vectors for per-frame gravity calculations
  private readonly _gravBodyPos = new THREE.Vector3();
  private readonly _gravTotalForce = new THREE.Vector3();
  private readonly _gravDirection = new THREE.Vector3();

  async initialize(): Promise<void> {
    if (this.initialized) return;
    await RAPIER.init();
    this.world = new RAPIER.World({ x: 0, y: 0, z: 0 });
    this.world.timestep = this.fixedTimestep;
    this.initialized = true;
  }

  bridge(object: THREE.Object3D, options: PhysicsBridgeOptions): RigidBody {
    if (!this.initialized) {
      throw new Error('PhysicsManager must be initialized before bridging objects.');
    }

    const position = object.position;
    const rotation = object.quaternion;
    let desc = this.createRigidBodyDesc(options.kind);
    desc = desc
      .setTranslation(position.x / this.scale, position.y / this.scale, position.z / this.scale)
      .setRotation({ x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w })
      .setGravityScale(options.gravityScale ?? 0)
      .setLinearDamping(options.linearDamping ?? 0.15)
      .setAngularDamping(options.angularDamping ?? 0.4)
      .setCanSleep(options.canSleep ?? options.kind !== 'dynamic');

    if (options.mass && options.kind === 'dynamic') {
      desc = desc.setAdditionalMass(options.mass);
    }

    if (options.ccd) {
      desc = desc.setCcdEnabled(true);
    }

    const body = this.world.createRigidBody(desc);
    const colliderDesc = this.createColliderDesc(options);
    const collider = this.world.createCollider(colliderDesc, body);

    this.bridges.set(object, {
      object, body, collider, kind: options.kind,
      prevPosition: object.position.clone(),
      prevQuaternion: object.quaternion.clone(),
    });
    this.syncObjectFromBody(object, body);
    return body;
  }

  has(object: THREE.Object3D): boolean {
    return this.bridges.has(object);
  }

  setPlayerObject(object: THREE.Object3D): void {
    this.playerObject = object;
  }

  getPlayerPosition(): THREE.Vector3 | null {
    if (!this.playerObject) return null;
    return this.getObjectPosition(this.playerObject);
  }

  getObjectPosition(object: THREE.Object3D, target?: THREE.Vector3): THREE.Vector3 {
    const out = target ?? new THREE.Vector3();
    const bridge = this.bridges.get(object);
    if (!bridge) {
      return out.copy(object.position);
    }

    const translation = bridge.body.translation();
    return out.set(
      translation.x * this.scale,
      translation.y * this.scale,
      translation.z * this.scale,
    );
  }

  getLinearVelocity(object: THREE.Object3D, target?: THREE.Vector3): THREE.Vector3 {
    const out = target ?? new THREE.Vector3();
    const bridge = this.bridges.get(object);
    if (!bridge) return out.set(0, 0, 0);
    const velocity = bridge.body.linvel();
    return out.set(
      velocity.x * this.scale,
      velocity.y * this.scale,
      velocity.z * this.scale,
    );
  }

  setTranslation(object: THREE.Object3D, position: THREE.Vector3, wakeUp = true): void {
    const bridge = this.bridges.get(object);
    if (!bridge) {
      object.position.copy(position);
      return;
    }

    bridge.body.setTranslation({
      x: position.x / this.scale,
      y: position.y / this.scale,
      z: position.z / this.scale,
    }, wakeUp);
    object.position.copy(position);
  }

  setLinvel(object: THREE.Object3D, velocity: THREE.Vector3, wakeUp = true): void {
    const bridge = this.bridges.get(object);
    if (!bridge) return;
    bridge.body.setLinvel({
      x: velocity.x / this.scale,
      y: velocity.y / this.scale,
      z: velocity.z / this.scale,
    }, wakeUp);
  }

  setKinematicTarget(object: THREE.Object3D, position: THREE.Vector3, quaternion?: THREE.Quaternion): void {
    const bridge = this.bridges.get(object);
    if (!bridge) {
      object.position.copy(position);
      if (quaternion) object.quaternion.copy(quaternion);
      return;
    }

    if (bridge.kind !== 'kinematic') {
      this.setTranslation(object, position, true);
      if (quaternion) {
        bridge.body.setRotation(quaternion, true);
      }
      return;
    }

    bridge.body.setNextKinematicTranslation({
      x: position.x / this.scale,
      y: position.y / this.scale,
      z: position.z / this.scale,
    });

    if (quaternion) {
      bridge.body.setNextKinematicRotation({
        x: quaternion.x,
        y: quaternion.y,
        z: quaternion.z,
        w: quaternion.w,
      });
    }

    object.position.copy(position);
    if (quaternion) object.quaternion.copy(quaternion);
  }

  applyImpulse(object: THREE.Object3D, impulse: THREE.Vector3, wakeUp = true): void {
    const bridge = this.bridges.get(object);
    if (!bridge) return;
    bridge.body.applyImpulse({
      x: impulse.x / this.scale,
      y: impulse.y / this.scale,
      z: impulse.z / this.scale,
    }, wakeUp);
  }

  applyForce(object: THREE.Object3D, force: THREE.Vector3, wakeUp = true): void {
    const bridge = this.bridges.get(object);
    if (!bridge) return;
    bridge.body.addForce({
      x: force.x / this.scale,
      y: force.y / this.scale,
      z: force.z / this.scale,
    }, wakeUp);
  }

  applyInverseSquareGravity(
    object: THREE.Object3D,
    sources: Array<{ position: THREE.Vector3; mass: number }>,
    gravitationalConstant: number,
  ): void {
    const bridge = this.bridges.get(object);
    if (bridge?.kind !== 'dynamic') return;

    const bodyPosition = this.getObjectPosition(object, this._gravBodyPos);
    const bodyMass = Math.max(bridge.body.mass(), 0.0001);
    this._gravTotalForce.set(0, 0, 0);

    for (const source of sources) {
      this._gravDirection.subVectors(source.position, bodyPosition);
      const distanceSq = Math.max(this._gravDirection.lengthSq(), 16);
      this._gravDirection.normalize();
      const forceMagnitude = gravitationalConstant * source.mass * bodyMass / distanceSq;
      this._gravTotalForce.addScaledVector(this._gravDirection, forceMagnitude);
    }

    this.applyForce(object, this._gravTotalForce, true);
  }

  step(elapsedSeconds: number): void {
    if (!this.initialized) return;

    if (this.lastStepTime === 0) {
      this.lastStepTime = elapsedSeconds;
    }

    const frameDelta = Math.min(elapsedSeconds - this.lastStepTime, 1 / 15);
    this.lastStepTime = elapsedSeconds;
    this.accumulator += Math.max(frameDelta, 0);

    while (this.accumulator >= this.fixedTimestep) {
      // Store pre-step positions for interpolation
      for (const bridge of this.bridges.values()) {
        const t = bridge.body.translation();
        const r = bridge.body.rotation();
        bridge.prevPosition.set(t.x * this.scale, t.y * this.scale, t.z * this.scale);
        bridge.prevQuaternion.set(r.x, r.y, r.z, r.w);
      }
      this.world.step();
      this.accumulator -= this.fixedTimestep;
    }

    // Interpolate visual positions: alpha = leftover fraction toward next physics frame
    const alpha = this.accumulator / this.fixedTimestep;
    this.interpolateAllObjects(alpha);
  }

  shiftWorld(shiftInThreeUnits: THREE.Vector3): void {
    if (!this.initialized) return;

    for (const bridge of this.bridges.values()) {
      const position = this.getObjectPosition(bridge.object).sub(shiftInThreeUnits);
      bridge.body.setTranslation({
        x: position.x / this.scale,
        y: position.y / this.scale,
        z: position.z / this.scale,
      }, false);
      this.syncObjectFromBody(bridge.object, bridge.body);
    }
  }

  dispose(): void {
    this.bridges.clear();
    this.playerObject = null;
  }

  private syncAllObjectsFromBodies(): void {
    for (const bridge of this.bridges.values()) {
      this.syncObjectFromBody(bridge.object, bridge.body);
    }
  }

  private interpolateAllObjects(alpha: number): void {
    for (const bridge of this.bridges.values()) {
      const t = bridge.body.translation();
      const r = bridge.body.rotation();
      // Lerp position between previous and current physics state
      bridge.object.position.set(
        bridge.prevPosition.x + (t.x * this.scale - bridge.prevPosition.x) * alpha,
        bridge.prevPosition.y + (t.y * this.scale - bridge.prevPosition.y) * alpha,
        bridge.prevPosition.z + (t.z * this.scale - bridge.prevPosition.z) * alpha,
      );
      // Slerp quaternion
      bridge.object.quaternion.set(bridge.prevQuaternion.x, bridge.prevQuaternion.y, bridge.prevQuaternion.z, bridge.prevQuaternion.w);
      bridge.object.quaternion.slerp(new THREE.Quaternion(r.x, r.y, r.z, r.w), alpha);
    }
  }

  private syncObjectFromBody(object: THREE.Object3D, body: RigidBody): void {
    const translation = body.translation();
    const rotation = body.rotation();
    object.position.set(
      translation.x * this.scale,
      translation.y * this.scale,
      translation.z * this.scale,
    );
    object.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
  }

  private createRigidBodyDesc(kind: PhysicsBodyKind): RigidBodyDesc {
    switch (kind) {
      case 'dynamic':
        return RigidBodyDesc.dynamic();
      case 'kinematic':
        return RigidBodyDesc.kinematicPositionBased();
      default:
        return RigidBodyDesc.fixed();
    }
  }

  private createColliderDesc(options: PhysicsBridgeOptions): ColliderDesc {
    switch (options.collider) {
      case 'ball': {
        const radius = (options.radius ?? 1) / this.scale;
        return ColliderDesc.ball(radius);
      }
      case 'capsule': {
        const radius = (options.radius ?? 0.5) / this.scale;
        const halfHeight = (options.halfHeight ?? 0.5) / this.scale;
        return ColliderDesc.capsule(halfHeight, radius);
      }
      default: {
        const halfExtents = options.halfExtents ?? new THREE.Vector3(0.5, 0.5, 0.5);
        return ColliderDesc.cuboid(
          halfExtents.x / this.scale,
          halfExtents.y / this.scale,
          halfExtents.z / this.scale,
        );
      }
    }
  }
}